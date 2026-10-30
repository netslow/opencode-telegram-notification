/**
 * telegram:test-send — отправляет тестовое сообщение в Telegram тем же кодом,
 * что плагин (TelegramNotifier + formatNotification + прокси), проверяя
 * токен, chat_id, прокси и сеть end-to-end.
 *
 * Коды выхода:
 *   0 — сообщение отправлено
 *   1 — конфигурация неполная или отправка не удалась
 */
import {
  loadTelegramConfig,
  resolveGlobalConfigDir,
} from "../.opencode/plugins/telegram-notify/config.js"
import { formatNotification } from "../.opencode/plugins/telegram-notify/formatter.js"
import { TelegramNotifier } from "../.opencode/plugins/telegram-notify/notifier.js"

const directory = process.cwd()
const globalDirectory = resolveGlobalConfigDir()
const config = loadTelegramConfig({ directory, globalDirectory })

if (!config.enabled) {
  console.error("X Plugin is DISABLED. Запустите `npm run telegram:diagnose`, чтобы понять почему.")
  process.exit(1)
}

const text = formatNotification(
  {
    sessionID: "test-send",
    prompt: "Тестовое сообщение от telegram-notify",
    status: "success",
    project: "telegram-notify",
    requestedAt: Date.now() - 3_000,
    finishedAt: Date.now(),
  },
  { locale: config.locale },
)

const notifier = new TelegramNotifier(config, {
  log: (message) => console.log(`  [notifier] ${message}`),
})

const result = await notifier.send(text)
if (result.ok) {
  console.log(`OK — тестовое сообщение отправлено в чат ${config.chatId}.`)
  process.exit(0)
}
console.error(`X Send failed: ${result.reason ?? result.error ?? "unknown"}`)
process.exit(1)
