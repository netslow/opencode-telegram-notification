import { describe, expect, it } from "vitest"
import {
  formatAwaitingInput,
  formatNotification,
} from "../.opencode/plugins/telegram-notify/formatter.js"
import type { RunCompletionData } from "../.opencode/plugins/telegram-notify/types.js"

function data(overrides: Partial<RunCompletionData> = {}): RunCompletionData {
  return {
    status: "success",
    prompt: "Реализуй X и сообщи мне в Telegram.",
    project: "my-project",
    sessionID: "session-1",
    requestedAt: 1_000,
    finishedAt: 61_000,
    ...overrides,
  }
}

describe("formatNotification (Russian)", () => {
  it("formats a successful run", () => {
    const text = formatNotification(
      data({ result: "Готово, X реализован.", model: "anthropic/claude", directory: "C:\\dev\\my-project" }),
      { locale: "ru" },
    )
    expect(text).toContain("✅ OpenCode завершил выполнение")
    expect(text).toContain("Запрос:")
    expect(text).toContain("Реализуй X и сообщи мне в Telegram.")
    expect(text).toContain("Результат:")
    expect(text).toContain("Готово, X реализован.")
    expect(text).toContain("Проект:")
    expect(text).toContain("my-project")
    expect(text).toContain("Время: 1 мин")
    expect(text).toContain("Модель:")
    expect(text).toContain("Рабочая директория:")
    expect(text).toContain("Run ID: session-1")
  })

  it("formats an errored run", () => {
    const text = formatNotification(
      data({ status: "error", error: "APIError: 401 unauthorized", result: undefined }),
      { locale: "ru" },
    )
    expect(text).toContain("❌ OpenCode завершил работу с ошибкой")
    expect(text).toContain("Ошибка:")
    expect(text).toContain("APIError: 401 unauthorized")
  })

  it("does not include optional fields when absent", () => {
    const text = formatNotification(
      data({ model: undefined, directory: undefined, sessionTitle: undefined }),
      { locale: "ru" },
    )
    expect(text).not.toContain("Модель:")
    expect(text).not.toContain("Рабочая директория:")
    expect(text).not.toContain("Сессия:")
  })

  it("truncates long prompt and result", () => {
    const longPrompt = "x".repeat(600)
    const longResult = "y".repeat(1000)
    const text = formatNotification(
      data({ prompt: longPrompt, result: longResult }),
      { maxPromptChars: 100, maxResultChars: 100, locale: "ru" },
    )
    expect(text).toContain(longPrompt.slice(0, 100).trimEnd() + "…")
    expect(text).toContain(longResult.slice(0, 100).trimEnd() + "…")
  })

  it("renders short durations in seconds", () => {
    const text = formatNotification(
      data({ requestedAt: 0, finishedAt: 5_000 }),
      { locale: "ru" },
    )
    expect(text).toContain("Время: 5 сек")
  })

  it("does not include secrets", () => {
    const text = formatNotification(data({ prompt: "prompt", result: "result" }), { locale: "ru" })
    expect(text).not.toMatch(/TELEGRAM_BOT_TOKEN/)
    expect(text).not.toMatch(/bot\d+:[\w-]+/)
  })
})

describe("formatNotification (English)", () => {
  it("formats a successful run", () => {
    const text = formatNotification(
      data({ result: "Done.", model: "anthropic/claude", directory: "C:\\dev\\my-project" }),
      { locale: "en" },
    )
    expect(text).toContain("✅ OpenCode completed successfully")
    expect(text).toContain("Request:")
    expect(text).toContain("Result:")
    expect(text).toContain("Done.")
    expect(text).toContain("Project:")
    expect(text).toContain("my-project")
    expect(text).toContain("Duration: 1 min")
    expect(text).toContain("Model:")
    expect(text).toContain("Working directory:")
    expect(text).toContain("Run ID: session-1")
  })

  it("formats an errored run", () => {
    const text = formatNotification(
      data({ status: "error", error: "APIError: 401 unauthorized", result: undefined }),
      { locale: "en" },
    )
    expect(text).toContain("❌ OpenCode finished with an error")
    expect(text).toContain("Error:")
    expect(text).toContain("APIError: 401 unauthorized")
  })

  it("renders short durations in seconds", () => {
    const text = formatNotification(
      data({ requestedAt: 0, finishedAt: 5_000 }),
      { locale: "en" },
    )
    expect(text).toContain("Duration: 5 s")
  })
})

describe("formatNotification (Spanish)", () => {
  it("formats a successful run", () => {
    const text = formatNotification(
      data({
        prompt: "Implementa X y avísame por Telegram.",
        result: "Listo, X implementado.",
        model: "anthropic/claude",
        directory: "C:\\dev\\my-project",
      }),
      { locale: "es" },
    )
    expect(text).toContain("✅ OpenCode completó la ejecución correctamente")
    expect(text).toContain("Solicitud:")
    expect(text).toContain("Implementa X y avísame por Telegram.")
    expect(text).toContain("Resultado:")
    expect(text).toContain("Listo, X implementado.")
    expect(text).toContain("Proyecto:")
    expect(text).toContain("my-project")
    expect(text).toContain("Duración: 1 min")
    expect(text).toContain("Modelo:")
    expect(text).toContain("Directorio de trabajo:")
    expect(text).toContain("Run ID: session-1")
  })

  it("formats an errored run", () => {
    const text = formatNotification(
      data({ status: "error", error: "APIError: 401 unauthorized", result: undefined }),
      { locale: "es" },
    )
    expect(text).toContain("❌ OpenCode terminó con un error")
    expect(text).toContain("Error:")
    expect(text).toContain("APIError: 401 unauthorized")
  })

  it("renders short durations in seconds", () => {
    const text = formatNotification(
      data({ requestedAt: 0, finishedAt: 5_000 }),
      { locale: "es" },
    )
    expect(text).toContain("Duración: 5 s")
  })
})

describe("formatNotification (locale fallback)", () => {
  it("falls back to English for an unsupported locale", () => {
    const text = formatNotification(data({ result: "Done." }), { locale: "fr" })
    expect(text).toContain("✅ OpenCode completed successfully")
    expect(text).toContain("Request:")
  })
})

describe("formatAwaitingInput (Russian)", () => {
  it("formats a single question", () => {
    const text = formatAwaitingInput(
      {
        kind: "question",
        project: "my-project",
        sessionID: "s1",
        questions: ["Продолжать работу?"],
      },
      { locale: "ru" },
    )
    expect(text).toContain("⚠️ OpenCode ждёт твой ответ")
    expect(text).toContain("Вопрос:")
    expect(text).toContain("Продолжать работу?")
    expect(text).toContain("Проект:")
    expect(text).toContain("my-project")
    expect(text).toContain("Run ID: s1")
    expect(text).toContain("→ Открой OpenCode, чтобы ответить")
  })

  it("formats multiple questions with numbering", () => {
    const text = formatAwaitingInput(
      {
        kind: "question",
        project: "my-project",
        questions: ["Вопрос один?", "Вопрос два?"],
      },
      { locale: "ru" },
    )
    expect(text).toContain("Вопрос:\nВопрос один?")
    expect(text).toContain("Вопрос 2:\nВопрос два?")
  })

  it("falls back when no question text is present", () => {
    const text = formatAwaitingInput(
      { kind: "question", project: "my-project" },
      { locale: "ru" },
    )
    expect(text).toContain("Вопрос:\n—")
  })

  it("formats a permission request with patterns", () => {
    const text = formatAwaitingInput(
      {
        kind: "permission",
        project: "my-project",
        sessionID: "s1",
        permission: "bash",
        patterns: ["npm run build", "git status"],
      },
      { locale: "ru" },
    )
    expect(text).toContain("🔐 OpenCode запрашивает разрешение")
    expect(text).toContain("Действие:\nbash")
    expect(text).toContain("Цели:\nnpm run build, git status")
    expect(text).toContain("→ Открой OpenCode, чтобы ответить")
  })

  it("omits optional fields when absent", () => {
    const text = formatAwaitingInput(
      { kind: "permission", project: "my-project", permission: "bash" },
      { locale: "ru" },
    )
    expect(text).not.toContain("Цели:")
    expect(text).not.toContain("Run ID:")
  })

  it("truncates long content", () => {
    const longQuestion = "x".repeat(600)
    const text = formatAwaitingInput(
      { kind: "question", project: "my-project", questions: [longQuestion] },
      { maxPromptChars: 100, locale: "ru" },
    )
    expect(text).toContain(longQuestion.slice(0, 100).trimEnd() + "…")
  })
})

describe("formatAwaitingInput (English)", () => {
  it("formats a single question", () => {
    const text = formatAwaitingInput(
      {
        kind: "question",
        project: "my-project",
        sessionID: "s1",
        questions: ["Continue working?"],
      },
      { locale: "en" },
    )
    expect(text).toContain("⚠️ OpenCode is waiting for your answer")
    expect(text).toContain("Question:")
    expect(text).toContain("Continue working?")
    expect(text).toContain("Project:")
    expect(text).toContain("Run ID: s1")
    expect(text).toContain("→ Open OpenCode to answer")
  })

  it("formats multiple questions with numbering", () => {
    const text = formatAwaitingInput(
      {
        kind: "question",
        project: "my-project",
        questions: ["Question one?", "Question two?"],
      },
      { locale: "en" },
    )
    expect(text).toContain("Question:\nQuestion one?")
    expect(text).toContain("Question 2:\nQuestion two?")
  })

  it("formats a permission request with patterns", () => {
    const text = formatAwaitingInput(
      {
        kind: "permission",
        project: "my-project",
        sessionID: "s1",
        permission: "bash",
        patterns: ["npm run build", "git status"],
      },
      { locale: "en" },
    )
    expect(text).toContain("🔐 OpenCode is requesting permission")
    expect(text).toContain("Action:\nbash")
    expect(text).toContain("Targets:\nnpm run build, git status")
    expect(text).toContain("→ Open OpenCode to answer")
  })
})

describe("formatAwaitingInput (Spanish)", () => {
  it("formats a single question", () => {
    const text = formatAwaitingInput(
      {
        kind: "question",
        project: "my-project",
        sessionID: "s1",
        questions: ["¿Continuar con el trabajo?"],
      },
      { locale: "es" },
    )
    expect(text).toContain("⚠️ OpenCode espera tu respuesta")
    expect(text).toContain("Pregunta:")
    expect(text).toContain("¿Continuar con el trabajo?")
    expect(text).toContain("Proyecto:")
    expect(text).toContain("my-project")
    expect(text).toContain("Run ID: s1")
    expect(text).toContain("→ Abre OpenCode para responder")
  })

  it("formats multiple questions with numbering", () => {
    const text = formatAwaitingInput(
      {
        kind: "question",
        project: "my-project",
        questions: ["¿Primera pregunta?", "¿Segunda pregunta?"],
      },
      { locale: "es" },
    )
    expect(text).toContain("Pregunta:\n¿Primera pregunta?")
    expect(text).toContain("Pregunta 2:\n¿Segunda pregunta?")
  })

  it("formats a permission request with patterns", () => {
    const text = formatAwaitingInput(
      {
        kind: "permission",
        project: "my-project",
        sessionID: "s1",
        permission: "bash",
        patterns: ["npm run build", "git status"],
      },
      { locale: "es" },
    )
    expect(text).toContain("🔐 OpenCode solicita permiso")
    expect(text).toContain("Acción:\nbash")
    expect(text).toContain("Objetivos:\nnpm run build, git status")
    expect(text).toContain("→ Abre OpenCode para responder")
  })
})
