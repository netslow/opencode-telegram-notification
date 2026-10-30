/**
 * telegram:diagnose — показывает, что видит плагин telegram-notify, и
 * проверяет доступность api.telegram.org (getMe) тем же кодом, что плагин
 * (встроенный transport из notifier.js + прокси из конфига). Сообщения в чат НЕ шлёт.
 *
 * Коды выхода:
 *   0 — конфигурация и связь с Telegram в порядке
 *   1 — конфигурация неполная или связь недоступна
 */
import { existsSync } from "node:fs"
import {
  envFiles,
  loadTelegramConfig,
  resolveGlobalConfigDir,
} from "../.opencode/plugins/telegram-notify/config.js"
import { request } from "../.opencode/plugins/telegram-notify/notifier.js"

const directory = process.cwd()
const globalDirectory = resolveGlobalConfigDir()
const config = loadTelegramConfig({ directory, globalDirectory })

/** Скрыть credentials внутри URL прокси (http://user:pass@host). */
function maskProxy(value: string | undefined): string | undefined {
  if (!value) return value
  return value.replace(/^(https?:\/\/)([^/@:]+)(:[^/@]*)?(@)/, "$1$2***$4")
}

console.log("=== telegram-notify diagnose ===")
console.log(`directory:      ${directory}`)
console.log(`global config:  ${globalDirectory}`)
for (const file of envFiles({ directory, globalDirectory })) {
  console.log(`  env file: ${existsSync(file) ? "FOUND " : "missing"} ${file}`)
}
console.log("--- config ---")
console.log(`enabled:        ${config.enabled}`)
console.log(`bot token:      ${config.botToken ? `present (len=${config.botToken.length})` : "MISSING"}`)
console.log(`chat id:        ${config.chatId ?? "MISSING"}`)
console.log(`timeout (ms):   ${config.timeoutMs}`)
console.log(`retries:        ${config.retries}`)
console.log(`locale:         ${config.locale}`)
console.log(`log file:       ${config.logFile ?? "(none)"}`)
console.log(`http proxy:     ${maskProxy(config.proxy?.httpProxy) ?? "(none)"}`)
console.log(`https proxy:    ${maskProxy(config.proxy?.httpsProxy) ?? "(none)"}`)
console.log(`no proxy:       ${config.proxy?.noProxy ?? "(none)"}`)

if (!config.enabled) {
  console.error("\nX Plugin is DISABLED. Укажите TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID в одном из env-файлов выше.")
  process.exit(1)
}

console.log("\n--- api.telegram.org connectivity (getMe) ---")
const url = `https://api.telegram.org/bot${config.botToken}/getMe`
const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), config.timeoutMs)
try {
  const response = await request(url, { method: "GET", signal: controller.signal }, config.proxy)
  const body = (await response.json().catch(() => null)) as
    | { ok?: boolean; result?: { username?: string } }
    | null
  if (response.ok && body?.ok) {
    console.log(`OK — бот @${body.result?.username ?? "?"} доступен, токен валиден.`)
    process.exit(0)
  }
  const description =
    body && typeof body === "object" && "description" in body
      ? String((body as { description?: unknown }).description)
      : ""
  console.error(`X Telegram API error: HTTP ${response.status}${description ? ` — ${description}` : ""}`)
  process.exit(1)
} catch (error) {
  const raw = error instanceof Error ? error.message : String(error)
  console.error(`X Network error: ${raw.split(config.botToken ?? "").join("***")}`)
  console.error("  Проверьте, что прокси запущен и через него доступен api.telegram.org.")
  process.exit(1)
} finally {
  clearTimeout(timer)
}
