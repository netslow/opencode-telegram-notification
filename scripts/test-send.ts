/**
 * telegram:test-send — sends a test message to Telegram using the same code
 * as the plugin (TelegramNotifier + formatNotification + proxy), validating
 * the token, chat_id, proxy, and network end-to-end.
 *
 * Exit codes:
 *   0 — message sent
 *   1 — configuration is incomplete or sending failed
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
  console.error("X Plugin is DISABLED. Run `npm run telegram:diagnose` to find out why.")
  process.exit(1)
}

const text = formatNotification(
  {
    sessionID: "test-send",
    prompt: "Test message from telegram-notify",
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
  console.log(`OK — test message sent to chat ${config.chatId}.`)
  process.exit(0)
}
console.error(`X Send failed: ${result.reason ?? result.error ?? "unknown"}`)
process.exit(1)
