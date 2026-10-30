/**
 * Minimal i18n layer for the telegram-notify plugin.
 *
 * Supported locales are registered in `CATALOGS`. Unknown or missing locales
 * fall back to English (`en`), which is the default.
 *
 * Plain JavaScript (JSDoc types) so the plugin loads under OpenCode Desktop.
 */
import { en } from "./locales/en.js"
import { es } from "./locales/es.js"
import { ru } from "./locales/ru.js"

export const DEFAULT_LOCALE = "en"
export const SUPPORTED_LOCALES = ["en", "ru", "es"]

/**
 * A localized set of notification templates.
 *
 * @typedef {object} MessageCatalog
 * @property {string} code
 * @property {string} successTitle
 * @property {string} errorTitle
 * @property {string} request
 * @property {string} result
 * @property {string} error
 * @property {string} project
 * @property {string} durationLabel
 * @property {string} workingDirectory
 * @property {string} model
 * @property {string} session
 * @property {string} question
 * @property {(index: number) => string} questionNumbered
 * @property {string} permissionTitle
 * @property {string} waitingAnswerTitle
 * @property {string} action
 * @property {string} targets
 * @property {string} openHint
 * @property {(ms: number) => string} duration
 */

/** @type {Record<string, MessageCatalog>} */
const CATALOGS = { en, ru, es }

/**
 * Normalize a locale identifier to one of the supported locale codes.
 *
 * Examples: `ru-RU` → `ru`, `RU_ru.UTF-8` → `ru`, `en-US` → `en`,
 * anything unsupported → `en`.
 *
 * @param {unknown} input
 * @returns {string}
 */
export function normalizeLocale(input) {
  if (typeof input !== "string") return DEFAULT_LOCALE
  const value = input.trim().toLowerCase()
  if (!value) return DEFAULT_LOCALE
  const primary = value.split(/[-_]/)[0]
  return Object.prototype.hasOwnProperty.call(CATALOGS, primary)
    ? primary
    : DEFAULT_LOCALE
}

/**
 * Get the message catalog for a locale, falling back to English.
 *
 * @param {unknown} [locale]
 * @returns {MessageCatalog}
 */
export function getCatalog(locale) {
  return CATALOGS[normalizeLocale(locale)] ?? en
}

/**
 * @typedef {object} DetectLocaleOptions
 * @property {string | undefined} [preferred] Locale supplied by the host (OpenCode settings, plugin option, ...). Lower priority than `TELEGRAM_LANGUAGE`.
 * @property {Record<string, string | undefined>} [env]
 * @property {string} [defaultLocale] Fallback when no environment variable or system locale is available.
 */

/**
 * @param {DetectLocaleOptions} [options]
 * @returns {string}
 */
function defaultSystemLocale(options) {
  if (typeof options?.defaultLocale === "string" && options.defaultLocale.trim()) {
    return options.defaultLocale
  }
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale
    if (typeof locale === "string" && locale.trim()) return locale
  } catch {
    // Ignore Intl failures and fall back to the built-in default.
  }
  return DEFAULT_LOCALE
}

/**
 * Resolve the locale to use for notification templates.
 *
 * Precedence:
 *   1. `TELEGRAM_LANGUAGE` — an explicit user choice, so it always wins.
 *   2. `preferred` (OpenCode setting / explicit plugin option)
 *   3. `LC_ALL`
 *   4. `LANG`
 *   5. the system locale (or `defaultLocale` in tests)
 *
 * If the resolved locale is not supported, English is returned.
 *
 * @param {DetectLocaleOptions} [options]
 * @returns {string}
 */
export function detectLocale(options = {}) {
  const env = options.env ?? process.env

  /** @param {unknown} value */
  const clean = (value) =>
    typeof value === "string" && value.trim() ? value.trim() : undefined

  const raw =
    clean(env.TELEGRAM_LANGUAGE) ??
    clean(options.preferred) ??
    clean(env.LC_ALL) ??
    clean(env.LANG) ??
    defaultSystemLocale(options)

  return normalizeLocale(raw)
}
