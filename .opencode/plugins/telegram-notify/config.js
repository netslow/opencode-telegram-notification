/**
 * Configuration loading for the telegram-notify plugin.
 *
 * Reads TELEGRAM_* variables from the process environment first, then falls
 * back to `.env` files. `.env` never overrides an already-set environment
 * variable. The bot token is never written to logs.
 *
 * Plain JavaScript (JSDoc types) so the plugin loads under OpenCode Desktop,
 * whose Node runtime cannot import `.ts` files.
 */
import { existsSync, readFileSync } from "node:fs"
import { homedir, platform } from "node:os"
import { join, resolve } from "node:path"
import { detectLocale } from "./i18n.js"

export const DEFAULT_TIMEOUT_MS = 10_000
export const DEFAULT_RETRIES = 2
export const DEFAULT_RETRY_DELAY_MS = 1_500

const ENV_KEY_BOT_TOKEN = "TELEGRAM_BOT_TOKEN"
const ENV_KEY_CHAT_ID = "TELEGRAM_CHAT_ID"
const ENV_KEY_ENABLED = "TELEGRAM_ENABLED"
const ENV_KEY_TIMEOUT = "TELEGRAM_TIMEOUT_SECONDS"
const ENV_KEY_RETRIES = "TELEGRAM_RETRIES"

const ENV_KEY_HTTP_PROXY = "HTTP_PROXY"
const ENV_KEY_HTTPS_PROXY = "HTTPS_PROXY"
const ENV_KEY_NO_PROXY = "NO_PROXY"

/**
 * @typedef {object} LoadTelegramConfigOptions
 * @property {string} [directory] Project working directory — used to locate a local `.env` file.
 * @property {string} [globalDirectory] Global config directory — used to locate a global `.env` file.
 * @property {NodeJS.ProcessEnv} [env]
 * @property {string[]} [envFiles] Paths of `.env` files to read, in addition to the defaults.
 * @property {string} [language] Locale/language preferred by the host (OpenCode setting). `TELEGRAM_LANGUAGE` takes priority over it.
 * @property {object} [fs]
 * @property {(path: string) => boolean} fs.existsSync
 * @property {(path: string, encoding: "utf8") => string} fs.readFileSync
 */

/**
 * Read a proxy variable honoring the conventional lowercase variants.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string} upperKey
 * @returns {string | undefined}
 */
function readProxyVar(env, upperKey) {
  const value = env[upperKey] ?? env[upperKey.toLowerCase()]
  return value?.trim() || undefined
}

/**
 * Resolve the opencode global config directory used for the global `.env`.
 *
 *   - Windows:   `%USERPROFILE%\.config\opencode`
 *   - Linux/macOS: `$XDG_CONFIG_HOME/opencode` when set, else `~/.config/opencode`
 *
 * No machine-specific paths are hardcoded; the user home comes from the
 * environment (USERPROFILE / HOME) with a fallback to `os.homedir()`.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [platformName] Test hook; defaults to `process.platform`.
 * @returns {string}
 */
export function resolveGlobalConfigDir(env = process.env, platformName = platform()) {
  if (platformName === "win32") {
    const home = env.USERPROFILE?.trim() || homedir()
    return join(home, ".config", "opencode")
  }
  const xdg = env.XDG_CONFIG_HOME?.trim()
  if (xdg) return join(xdg, "opencode")
  const home = env.HOME?.trim() || homedir()
  return join(home, ".config", "opencode")
}

/**
 * Default diagnostic log file for the plugin.
 *
 *   - Windows:   `%USERPROFILE%\.local\share\opencode\log\telegram-notify.log`
 *   - Linux/macOS: `$XDG_DATA_HOME/opencode/log/telegram-notify.log` when
 *     `XDG_DATA_HOME` is set, else `~/.local/share/opencode/log/telegram-notify.log`
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [platformName] Test hook; defaults to `process.platform`.
 * @returns {string}
 */
export function resolveLogFile(env = process.env, platformName = platform()) {
  if (platformName === "win32") {
    const home = env.USERPROFILE?.trim() || homedir()
    return join(home, ".local", "share", "opencode", "log", "telegram-notify.log")
  }
  const xdgData = env.XDG_DATA_HOME?.trim()
  const data = xdgData || join(env.HOME?.trim() || homedir(), ".local", "share")
  return join(data, "opencode", "log", "telegram-notify.log")
}

/**
 * Parse a single `.env` file into a key/value map.
 *
 * Supports `KEY=VALUE`, `export KEY=VALUE`, optional single/double quotes
 * around values, blank lines and `#` comments.
 *
 * @param {string} content
 * @returns {Record<string, string>}
 */
export function parseEnvFile(content) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    let value = match[2].trim()
    if (value.length >= 2) {
      const first = value[0]
      const last = value[value.length - 1]
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1)
      }
    }
    out[match[1]] = value
  }
  return out
}

/**
 * The `.env` file paths the plugin reads, in order of ascending priority:
 * `<directory>/.env`, `<globalDirectory>/.env`, then explicit `envFiles`.
 *
 * The `<directory>/.env` (project) candidate is skipped when `directory` is the
 * user's home directory — a home directory is not a project, and `~/.env` must
 * not be treated as a project `.env`.
 *
 * @param {LoadTelegramConfigOptions} [options]
 * @returns {string[]}
 */
export function envFiles(options = {}) {
  const files = []
  const home = resolve(homedir())
  if (options.directory && !sameResolvedPath(options.directory, home)) {
    files.push(`${options.directory}/.env`)
  }
  if (options.globalDirectory) files.push(`${options.globalDirectory}/.env`)
  for (const file of options.envFiles ?? []) files.push(file)
  return files
}

/**
 * Case-insensitive path comparison on Windows, exact elsewhere.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function sameResolvedPath(a, b) {
  const na = resolve(a)
  const nb = resolve(b)
  return platform() === "win32" ? na.toLowerCase() === nb.toLowerCase() : na === nb
}

/**
 * Load the merged environment for the plugin.
 *
 * Precedence (highest first):
 *   1. already-set process environment variables
 *   2. `<directory>/.env`
 *   3. `<globalDirectory>/.env`
 *
 * Explicitly listed `envFiles` are read in order and are lower priority than
 * already-set environment variables but higher priority than the defaults.
 *
 * @param {LoadTelegramConfigOptions} [options]
 * @returns {Record<string, string | undefined>}
 */
export function loadEnv(options = {}) {
  const env = options.env ?? process.env
  /** @type {NonNullable<LoadTelegramConfigOptions["fs"]>} */
  const fsImpl = options.fs ?? {
    existsSync,
    readFileSync,
  }

  const files = envFiles(options)

  const merged = { ...env }
  for (const file of files) {
    if (!file) continue
    let content
    try {
      if (!fsImpl.existsSync(file)) continue
      content = fsImpl.readFileSync(file, "utf8")
    } catch {
      continue
    }
    const parsed = parseEnvFile(content)
    for (const [key, value] of Object.entries(parsed)) {
      if (merged[key] === undefined) merged[key] = value
    }
  }
  return merged
}

/**
 * @param {string | undefined} value
 * @param {number} fallback
 * @returns {number}
 */
function parseIntEnv(value, fallback) {
  if (value === undefined || value === "") return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * Resolve the notification locale from the current environment and `.env`
 * files.
 *
 * Kept separate from `loadTelegramConfig` so the plugin can call it for every
 * notification: an edited `TELEGRAM_LANGUAGE` then takes effect on the next
 * message instead of staying frozen until OpenCode restarts.
 *
 * @param {LoadTelegramConfigOptions} [options]
 * @returns {string}
 */
export function resolveLocale(options = {}) {
  const env = loadEnv(options)
  return detectLocale({ env, preferred: options.language })
}

/**
 * Build the Telegram configuration from the environment.
 *
 * `enabled` is true only when the feature is not explicitly disabled AND both
 * `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are present.
 *
 * @param {LoadTelegramConfigOptions} [options]
 * @returns {import("./types.js").TelegramConfig}
 */
export function loadTelegramConfig(options = {}) {
  const env = loadEnv(options)
  const botToken = env[ENV_KEY_BOT_TOKEN]?.trim() || undefined
  const chatId = env[ENV_KEY_CHAT_ID]?.trim() || undefined
  const enabledFlag = env[ENV_KEY_ENABLED]?.trim().toLowerCase()

  const httpProxy = readProxyVar(env, ENV_KEY_HTTP_PROXY)
  const httpsProxy = readProxyVar(env, ENV_KEY_HTTPS_PROXY)
  const noProxy = readProxyVar(env, ENV_KEY_NO_PROXY)

  const enabled = enabledFlag !== "false" && Boolean(botToken) && Boolean(chatId)

  return {
    enabled,
    botToken,
    chatId,
    timeoutMs: parseIntEnv(env[ENV_KEY_TIMEOUT], DEFAULT_TIMEOUT_MS) * 1000,
    retries: parseIntEnv(env[ENV_KEY_RETRIES], DEFAULT_RETRIES),
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
    proxy: { httpProxy, httpsProxy, noProxy },
    logFile: resolveLogFile(env),
    locale: detectLocale({ env, preferred: options.language }),
  }
}

/**
 * Redact the bot token from an arbitrary string (e.g. an error message that
 * may include the request URL). Used before anything is written to a log.
 *
 * @param {string} value
 * @param {import("./types.js").TelegramConfig} config
 * @returns {string}
 */
export function redactToken(value, config) {
  if (!value || !config.botToken) return value
  return value.split(config.botToken).join("***")
}
