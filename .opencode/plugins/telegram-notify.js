/**
 * telegram-notify — OpenCode V2 plugin.
 *
 * Sends a Telegram notification when the *current* user prompt/run completes.
 * A notification is queued for every user prompt, so a Telegram message is
 * sent after every completed run (success or error). When a run pauses to
 * wait for the user — the model asks a question (`form.created`) or a
 * tool needs permission (`permission.asked`) — an immediate Telegram
 * notification is sent too (deduped, max one per 30 s per session).
 *
 * Mechanism (real OpenCode V2 APIs):
 *   - `ctx.session.hook("prompt", ...)` → user prompt submitted (captures text)
 *   - `ctx.event.subscribe(...)`        → `session.execution.succeeded` = run completed
 *                                        → `session.execution.failed`    = run failed
 *                                        → `session.execution.interrupted` = run stopped
 *                                        → `form.created` / `permission.asked` = waits for user
 *
 * The plugin is auto-discovered from `.opencode/plugins/*.ts|js`. It is
 * written as plain JavaScript (JSDoc types) because OpenCode Desktop loads
 * file plugins via Node's raw `import()`, and Node cannot import `.ts` files.
 * It never throws, so it can never break an opencode run.
 */
import { appendFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import {
  envFiles,
  loadTelegramConfig,
  redactToken,
  resolveGlobalConfigDir,
  resolveLocale,
} from "./telegram-notify/config.js"
import { formatAwaitingInput, formatNotification } from "./telegram-notify/formatter.js"
import { LifecycleTracker } from "./telegram-notify/lifecycle.js"
import { TelegramNotifier } from "./telegram-notify/notifier.js"

const PLUGIN_ID = "telegram-notify"

/**
 * @param {string | undefined} path
 * @returns {string}
 */
function baseName(path) {
  if (!path) return ""
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? ""
}

/**
 * Read a preferred locale from the OpenCode plugin context, if the host
 * exposes one. It is only a fallback: `TELEGRAM_LANGUAGE` always wins.
 *
 * @param {import("./telegram-notify/types.js").PluginContext | undefined} ctx
 * @returns {string | undefined}
 */
function preferredLanguage(ctx) {
  const options = ctx?.options
  if (!options || typeof options !== "object") return undefined
  for (const key of ["language", "locale", "lang"]) {
    const value = /** @type {unknown} */ (options[key])
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return undefined
}

/**
 * Sanitize an arbitrary log payload so the bot token can never leak.
 *
 * @param {unknown} value
 * @param {import("./telegram-notify/types.js").TelegramConfig} config
 * @returns {unknown}
 */
function sanitize(value, config) {
  if (typeof value === "string") return redactToken(value, config)
  if (Array.isArray(value)) return value.map((item) => sanitize(item, config))
  if (value && typeof value === "object") {
    /** @type {Record<string, unknown>} */
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      out[key] = sanitize(item, config)
    }
    return out
  }
  return value
}

/**
 * Test-only injection points. OpenCode never passes overrides.
 *
 * @typedef {object} TelegramNotifyOverrides
 * @property {import("./telegram-notify/notifier.js").FetchLike} [fetchImpl]
 * @property {import("./telegram-notify/types.js").Logger} [log]
 */

/**
 * Build the telegram-notify plugin for a V2 plugin context.
 *
 * @param {import("./telegram-notify/types.js").PluginContext} ctx
 * @param {TelegramNotifyOverrides} [overrides]
 * @returns {Promise<() => void>}
 */
export async function createTelegramNotify(ctx, overrides = {}) {
  const location = ctx?.location
  const directory =
    typeof location?.directory === "string" && location.directory
      ? location.directory
      : process.cwd()
  const projectPath =
    location?.project?.canonical ||
    location?.project?.directory ||
    directory
  const globalDirectory = resolveGlobalConfigDir()
  const hostLanguage = preferredLanguage(ctx)
  const config = loadTelegramConfig({
    directory,
    globalDirectory,
    language: hostLanguage,
  })
  const project = baseName(projectPath) || baseName(directory) || "opencode"

  // Ensure the default log directory exists before the first append.
  let logDirEnsured = false

  /** @type {import("./telegram-notify/types.js").Logger} */
  const log = (level, message, extra) => {
    const safeMessage = redactToken(message, config)
    const safeExtra = extra
      ? /** @type {Record<string, unknown>} */ (sanitize(extra, config))
      : undefined

    try {
      overrides.log?.(level, safeMessage, safeExtra)
    } catch {
      // logging must never break the plugin
    }

    // Under vitest the real plugin entry is constructed (real global .env is
    // read), so skip console/file output to keep tests isolated.
    if (process.env.VITEST) return

    // V2 has no `client.app.log`; console output is captured by OpenCode.
    try {
      if (level !== "debug") {
        const sink =
          level === "error"
            ? console.error
            : level === "warn"
              ? console.warn
              : console.log
        sink(
          `[${PLUGIN_ID}] ${JSON.stringify({
            level,
            message: safeMessage,
            ...(safeExtra ? { extra: safeExtra } : {}),
          })}`,
        )
      }
    } catch {
      // logging must never break the plugin
    }

    if (config.logFile) {
      try {
        if (!logDirEnsured) {
          mkdirSync(dirname(config.logFile), { recursive: true })
          logDirEnsured = true
        }
        appendFileSync(
          config.logFile,
          `${JSON.stringify({ ts: new Date().toISOString(), level, message: safeMessage, extra: safeExtra })}\n`,
          "utf8",
        )
      } catch {
        // logging must never break the plugin
      }
    }
  }

  const notifier = new TelegramNotifier(config, {
    log: (message) => log("debug", `notifier: ${message}`),
    ...(overrides.fetchImpl ? { fetchImpl: overrides.fetchImpl } : {}),
  })

  const locale = config.locale

  /**
   * Resolve the locale for each notification instead of reusing the value
   * captured at plugin startup: editing `TELEGRAM_LANGUAGE` in `.env` then
   * applies to the next message without restarting OpenCode.
   *
   * @returns {string}
   */
  const currentLocale = () =>
    resolveLocale({ directory, globalDirectory, language: hostLanguage })

  const lifecycle = new LifecycleTracker({
    session: ctx.session,
    notifier,
    /**
     * @param {import("./telegram-notify/types.js").RunCompletionData} data
     * @returns {string}
     */
    formatter: (data) => formatNotification(data, { locale: currentLocale() }),
    /**
     * @param {import("./telegram-notify/formatter.js").AwaitingInputData} data
     * @returns {string}
     */
    awaitingFormatter: (data) =>
      formatAwaitingInput(data, { locale: currentLocale() }),
    project,
    directory,
    log,
  })

  const sources = envFiles({ directory, globalDirectory }).map((file) => ({
    file,
    exists: existsSync(file),
  }))

  if (!config.enabled) {
    const missing = []
    if (!config.botToken) missing.push("TELEGRAM_BOT_TOKEN")
    if (!config.chatId) missing.push("TELEGRAM_CHAT_ID")
    const reason =
      missing.length > 0
        ? `missing ${missing.join(", ")}`
        : "TELEGRAM_ENABLED=false"
    log("warn", `Telegram notification disabled: ${reason}`, {
      directory,
      globalConfigDir: globalDirectory,
      envFiles: sources,
    })
  } else {
    log("info", "Telegram notification enabled", {
      directory,
      globalConfigDir: globalDirectory,
      envFiles: sources,
      hasBotToken: Boolean(config.botToken),
      hasChatId: Boolean(config.chatId),
      locale,
      proxy: {
        httpProxy: Boolean(config.proxy?.httpProxy),
        httpsProxy: Boolean(config.proxy?.httpsProxy),
        noProxy: Boolean(config.proxy?.noProxy),
      },
      logFile: config.logFile ?? null,
    })
  }

  // V2 replaces the V1 `chat.message` hook with a session prompt hook.
  try {
    await ctx.session?.hook?.("prompt", (event) => {
      lifecycle.onPrompt(event)
    })
  } catch (error) {
    log("error", "failed to register prompt hook", {
      message: error instanceof Error ? error.message : String(error),
    })
  }

  // V2 replaces the V1 `event` hook with an abortable event subscription.
  const controller = new AbortController()
  if (typeof ctx.event?.subscribe === "function") {
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({
          signal: controller.signal,
        })) {
          await lifecycle.onEvent(event)
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          log("warn", "event subscription ended", {
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
    })()
  } else {
    log("warn", "event API is unavailable; notifications will not be sent")
  }

  return () => {
    controller.abort()
  }
}

/** Backwards-compatible name used by older tests/scripts. */
export const TelegramNotify = createTelegramNotify

/** @type {{ id: string, setup: (ctx: import("./telegram-notify/types.js").PluginContext) => Promise<() => void> }} */
const plugin = {
  id: PLUGIN_ID,
  setup: (ctx) => createTelegramNotify(ctx),
}

export default plugin
