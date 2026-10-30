/**
 * Notification message formatting.
 *
 * Pure component: turns a `RunCompletionData` into a plain-text Telegram
 * message. No secrets are ever included; prompt/result are truncated.
 *
 * The displayed language is selected via `options.locale`; supported locales
 * are registered in `./i18n.js`. Unknown locales fall back to English.
 *
 * Plain JavaScript (JSDoc types) so the plugin loads under OpenCode Desktop,
 * whose Node runtime cannot import `.ts` files.
 */
import { getCatalog } from "./i18n.js"

/**
 * @typedef {object} FormatOptions
 * @property {number} [maxPromptChars]
 * @property {number} [maxResultChars]
 * @property {number} [maxErrorChars]
 * @property {string} [locale]
 */

const DEFAULT_MAX_PROMPT = 500
const DEFAULT_MAX_RESULT = 800
const DEFAULT_MAX_ERROR = 500

export const SUCCESS_EMOJI = "✅"
export const ERROR_EMOJI = "❌"
export const QUESTION_EMOJI = "⚠️"
export const PERMISSION_EMOJI = "🔐"

/**
 * @param {string} value
 * @param {number} max
 * @returns {string}
 */
function truncate(value, max) {
  if (value.length <= max) return value
  return `${value.slice(0, max).trimEnd()}…`
}

/**
 * @param {import("./types.js").RunCompletionData} data
 * @param {FormatOptions} [options]
 * @returns {string}
 */
export function formatNotification(data, options = {}) {
  const catalog = getCatalog(options.locale)
  const maxPrompt = options.maxPromptChars ?? DEFAULT_MAX_PROMPT
  const maxResult = options.maxResultChars ?? DEFAULT_MAX_RESULT
  const maxError = options.maxErrorChars ?? DEFAULT_MAX_ERROR

  const lines = []

  if (data.status === "error") {
    lines.push(`${ERROR_EMOJI} ${catalog.errorTitle}`)
  } else {
    lines.push(`${SUCCESS_EMOJI} ${catalog.successTitle}`)
  }

  lines.push("", catalog.request)
  lines.push(truncate(data.prompt || "—", maxPrompt))

  if (data.status === "error") {
    if (data.error) {
      lines.push("", catalog.error)
      lines.push(truncate(data.error, maxError))
    } else if (data.result) {
      lines.push("", catalog.result)
      lines.push(truncate(data.result, maxResult))
    }
  } else if (data.result) {
    lines.push("", catalog.result)
    lines.push(truncate(data.result, maxResult))
  }

  lines.push("", catalog.project)
  lines.push(data.project || "—")

  const duration = catalog.duration(data.finishedAt - data.requestedAt)
  if (duration) lines.push("", `${catalog.durationLabel}: ${duration}`)

  if (data.directory) {
    lines.push("", catalog.workingDirectory)
    lines.push(data.directory)
  }

  if (data.model) {
    lines.push("", catalog.model)
    lines.push(data.model)
  }

  if (data.sessionTitle) {
    lines.push("", catalog.session)
    lines.push(data.sessionTitle)
  }

  lines.push("", `Run ID: ${data.sessionID}`)

  return lines.join("\n")
}

/**
 * @typedef {"question" | "permission"} AwaitingKind
 *
 * @typedef {object} AwaitingInputData
 * @property {AwaitingKind} kind
 * @property {string} project
 * @property {string[]} [questions] Question texts (kind "question").
 * @property {string} [permission] Permission name (kind "permission").
 * @property {string[]} [patterns]
 * @property {string} [sessionID]
 */

/**
 * Format a notification for the case where OpenCode pauses the run and waits
 * for the user (question asked by the model, or a tool permission request).
 *
 * @param {AwaitingInputData} data
 * @param {Pick<FormatOptions, "maxPromptChars" | "locale">} [options]
 * @returns {string}
 */
export function formatAwaitingInput(data, options = {}) {
  const catalog = getCatalog(options.locale)
  const max = options.maxPromptChars ?? DEFAULT_MAX_PROMPT
  const lines = []

  if (data.kind === "permission") {
    lines.push(`${PERMISSION_EMOJI} ${catalog.permissionTitle}`)
    if (data.permission) {
      lines.push("", catalog.action)
      lines.push(truncate(data.permission, max))
    }
    if (data.patterns && data.patterns.length > 0) {
      lines.push("", catalog.targets)
      lines.push(truncate(data.patterns.join(", "), max))
    }
  } else {
    lines.push(`${QUESTION_EMOJI} ${catalog.waitingAnswerTitle}`)
    const questions =
      data.questions && data.questions.length > 0 ? data.questions : ["—"]
    for (const [index, text] of questions.entries()) {
      lines.push(
        "",
        index === 0 ? catalog.question : catalog.questionNumbered(index + 1),
      )
      lines.push(truncate(text || "—", max))
    }
  }

  lines.push("", catalog.project)
  lines.push(data.project || "—")

  if (data.sessionID) {
    lines.push("", `Run ID: ${data.sessionID}`)
  }

  lines.push("", catalog.openHint)

  return lines.join("\n")
}
