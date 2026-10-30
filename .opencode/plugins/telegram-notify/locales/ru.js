/**
 * Russian message templates for the telegram-notify plugin.
 */

/**
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return ""
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds} сек`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return `${minutes} мин ${seconds} сек`
  const hours = Math.floor(minutes / 60)
  return `${hours} ч ${minutes % 60} мин`
}

/** @type {import("../i18n.js").MessageCatalog} */
export const ru = {
  code: "ru",

  successTitle: "OpenCode завершил выполнение",
  errorTitle: "OpenCode завершил работу с ошибкой",

  request: "Запрос:",
  result: "Результат:",
  error: "Ошибка:",
  project: "Проект:",
  durationLabel: "Время",
  workingDirectory: "Рабочая директория:",
  model: "Модель:",
  session: "Сессия:",

  question: "Вопрос:",
  /**
   * @param {number} index
   * @returns {string}
   */
  questionNumbered: (index) => `Вопрос ${index}:`,

  permissionTitle: "OpenCode запрашивает разрешение",
  waitingAnswerTitle: "OpenCode ждёт твой ответ",
  action: "Действие:",
  targets: "Цели:",
  openHint: "→ Открой OpenCode, чтобы ответить",

  duration: formatDuration,
}
