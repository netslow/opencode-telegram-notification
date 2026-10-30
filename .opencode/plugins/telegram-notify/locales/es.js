/**
 * Spanish message templates for the telegram-notify plugin.
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
export const es = {
  code: "es",

  successTitle: "OpenCode completó la ejecución correctamente",
  errorTitle: "OpenCode terminó con un error",

  request: "Solicitud:",
  result: "Resultado:",
  error: "Error:",
  project: "Proyecto:",
  durationLabel: "Duración",
  workingDirectory: "Directorio de trabajo:",
  model: "Modelo:",
  session: "Sesión:",
  question: "Pregunta:",
  /**
   * @param {number} index
   * @returns {string}
   */
  questionNumbered: (index) => `Pregunta ${index}:`,

  permissionTitle: "OpenCode solicita permiso",
  waitingAnswerTitle: "OpenCode espera tu respuesta",
  action: "Acción:",
  targets: "Objetivos:",
  openHint: "→ Abre OpenCode para responder",

  duration: formatDuration,
}
