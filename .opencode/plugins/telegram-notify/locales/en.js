/**
 * English message templates for the telegram-notify plugin.
 */

/**
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return ""
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds} s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return `${minutes} min ${seconds} s`
  const hours = Math.floor(minutes / 60)
  return `${hours} h ${minutes % 60} min`
}

/** @type {import("../i18n.js").MessageCatalog} */
export const en = {
  code: "en",

  successTitle: "OpenCode completed successfully",
  errorTitle: "OpenCode finished with an error",

  request: "Request:",
  result: "Result:",
  error: "Error:",
  project: "Project:",
  durationLabel: "Duration",
  workingDirectory: "Working directory:",
  model: "Model:",
  session: "Session:",

  question: "Question:",
  /**
   * @param {number} index
   * @returns {string}
   */
  questionNumbered: (index) => `Question ${index}:`,

  permissionTitle: "OpenCode is requesting permission",
  waitingAnswerTitle: "OpenCode is waiting for your answer",
  action: "Action:",
  targets: "Targets:",
  openHint: "→ Open OpenCode to answer",

  duration: formatDuration,
}
