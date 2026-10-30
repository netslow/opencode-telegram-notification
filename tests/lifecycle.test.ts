import { describe, expect, it, vi } from "vitest"
import { LifecycleTracker } from "../.opencode/plugins/telegram-notify/lifecycle.js"
import {
  formatAwaitingInput,
  formatNotification,
} from "../.opencode/plugins/telegram-notify/formatter.js"
import type {
  Logger,
  PromptEvent,
  SessionDomain,
  SessionMessage,
} from "../.opencode/plugins/telegram-notify/types.js"

function userMessage(id: string, text: string): SessionMessage {
  return { id, type: "user", text, time: { created: 0 } }
}

function assistantMessage(
  id: string,
  text: string,
  error?: SessionMessage["error"],
): SessionMessage {
  return {
    id,
    type: "assistant",
    content: [{ type: "text", text }],
    time: { created: 0, completed: 1 },
    ...(error ? { error } : {}),
  }
}

interface Harness {
  tracker: LifecycleTracker
  send: ReturnType<typeof vi.fn>
  session: SessionDomain
}

function makeHarness(options: {
  messages?: SessionMessage[]
  sendImpl?: () => Promise<{ ok: boolean }>
  awaitingFormatter?: (data: Parameters<typeof formatAwaitingInput>[0]) => string
  locale?: string
} = {}): Harness {
  const locale = options.locale ?? "ru"
  const send = vi.fn(
    async (_text: string): Promise<{ ok: boolean }> =>
      options.sendImpl ? await options.sendImpl() : { ok: true },
  )
  const session = {
    get: vi.fn(async () => ({
      id: "s1",
      title: "My Session",
      location: { directory: "/proj" },
      model: { providerID: "anthropic", id: "claude" },
      time: { created: 0, updated: 1 },
    })),
    context: vi.fn(async () => options.messages ?? []),
    hook: vi.fn(async () => ({ dispose: async () => {} })),
  } as unknown as SessionDomain
  const log: Logger = vi.fn()
  const tracker = new LifecycleTracker({
    session,
    notifier: { enabled: true, send },
    formatter: (data) => formatNotification(data, { locale }),
    awaitingFormatter: options.awaitingFormatter ?? ((data) => formatAwaitingInput(data, { locale })),
    project: "my-project",
    directory: "/proj",
    log,
    now: () => 2_000,
  })
  return { tracker, send, session }
}

const NOTIFY_PROMPT = "Сделай X и сообщи мне в Telegram, когда закончишь."
const PLAIN_PROMPT = "Покажи текущую структуру проекта."

const prompt = (text: string, sessionID = "s1"): PromptEvent => ({
  sessionID,
  messageID: "m1",
  prompt: { text },
  delivery: "steer",
})

const succeeded = (sessionID = "s1") => ({
  type: "session.execution.succeeded",
  data: { sessionID },
})

const failed = (
  sessionID = "s1",
  error: Record<string, unknown> = {
    type: "APIError",
    message: "401 unauthorized",
  },
) => ({
  type: "session.execution.failed",
  data: { sessionID, error },
})

const idle = (sessionID = "s1") => ({
  type: "session.idle",
  data: { sessionID },
})

const formCreated = (id: string, sessionID: string, questions: string[]) => ({
  type: "form.created",
  data: {
    form: {
      id,
      sessionID,
      title: "Question",
      fields: questions.map((title, index) => ({
        key: `q${index}`,
        title,
        type: "string",
      })),
    },
  },
})

const permissionAsked = (
  id: string,
  sessionID: string,
  action: string,
  resources: string[],
) => ({
  type: "permission.asked",
  data: { id, sessionID, action, resources },
})

describe("LifecycleTracker", () => {
  it("sends a success notification when a prompt completes", async () => {
    const h = makeHarness({
      messages: [userMessage("m1", NOTIFY_PROMPT), assistantMessage("m2", "Готово.")],
    })
    h.tracker.onPrompt(prompt(NOTIFY_PROMPT))
    await h.tracker.onEvent(succeeded())

    expect(h.send).toHaveBeenCalledTimes(1)
    const text = h.send.mock.calls[0][0] as string
    expect(text).toContain("✅ OpenCode завершил выполнение")
    expect(text).toContain(NOTIFY_PROMPT)
    expect(text).toContain("Готово.")
    expect(text).toContain("my-project")
    expect(text).toContain("anthropic/claude")
    expect(text).toContain("Run ID: s1")
  })

  it("sends an English notification when the locale is `en`", async () => {
    const promptText = "Fix the build."
    const h = makeHarness({
      locale: "en",
      messages: [userMessage("m1", promptText), assistantMessage("m2", "Done.")],
    })
    h.tracker.onPrompt(prompt(promptText))
    await h.tracker.onEvent(succeeded())

    expect(h.send).toHaveBeenCalledTimes(1)
    const text = h.send.mock.calls[0][0] as string
    expect(text).toContain("✅ OpenCode completed successfully")
    expect(text).toContain("Request:")
    expect(text).toContain("Result:")
    expect(text).toContain("Done.")
    expect(text).toContain("Run ID: s1")
  })

  it("sends an error notification when the run fails", async () => {
    const h = makeHarness()
    h.tracker.onPrompt(prompt(NOTIFY_PROMPT))
    await h.tracker.onEvent(failed())

    expect(h.send).toHaveBeenCalledTimes(1)
    const text = h.send.mock.calls[0][0] as string
    expect(text).toContain("❌ OpenCode завершил работу с ошибкой")
    expect(text).toContain("APIError: 401 unauthorized")
  })

  it("sends an error notification when the run is interrupted", async () => {
    const h = makeHarness()
    h.tracker.onPrompt(prompt(NOTIFY_PROMPT))
    await h.tracker.onEvent({
      type: "session.execution.interrupted",
      data: { sessionID: "s1", reason: "user" },
    })

    expect(h.send).toHaveBeenCalledTimes(1)
    const text = h.send.mock.calls[0][0] as string
    expect(text).toContain("❌")
    expect(text).toContain("Interrupted: user")
  })

  it("treats an assistant message error as a failed run", async () => {
    const h = makeHarness({
      messages: [
        userMessage("m1", NOTIFY_PROMPT),
        assistantMessage("m2", "", { type: "UnknownError", message: "boom" }),
      ],
    })
    h.tracker.onPrompt(prompt(NOTIFY_PROMPT))
    await h.tracker.onEvent(succeeded())

    expect(h.send).toHaveBeenCalledTimes(1)
    const text = h.send.mock.calls[0][0] as string
    expect(text).toContain("❌")
    expect(text).toContain("boom")
  })

  it("sends exactly once per run (completion + idle are deduped)", async () => {
    const h = makeHarness()
    h.tracker.onPrompt(prompt(NOTIFY_PROMPT))
    await h.tracker.onEvent(succeeded())
    await h.tracker.onEvent(succeeded())
    await h.tracker.onEvent(idle())

    expect(h.send).toHaveBeenCalledTimes(1)
  })

  it("falls back to session.idle when no execution event arrives", async () => {
    const h = makeHarness()
    h.tracker.onPrompt(prompt(NOTIFY_PROMPT))
    await h.tracker.onEvent(idle())

    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.send.mock.calls[0][0]).toContain("✅")
  })

  it("sends for a plain prompt too (notifications are always on)", async () => {
    const h = makeHarness()
    h.tracker.onPrompt(prompt(PLAIN_PROMPT))
    await h.tracker.onEvent(succeeded())

    h.tracker.onPrompt(prompt("Сделай Y."))
    await h.tracker.onEvent(succeeded())

    expect(h.send).toHaveBeenCalledTimes(2)
  })

  it("sends for each of two consecutive prompts", async () => {
    const h = makeHarness()
    const secondPrompt = "Сделай Y и тоже сообщи мне в Telegram."

    h.tracker.onPrompt(prompt(NOTIFY_PROMPT))
    await h.tracker.onEvent(succeeded())

    h.tracker.onPrompt(prompt(secondPrompt))
    await h.tracker.onEvent(succeeded())

    expect(h.send).toHaveBeenCalledTimes(2)
    expect(h.send.mock.calls[1][0]).toContain(secondPrompt)
  })

  it("does not send when no user prompt was captured", async () => {
    const h = makeHarness()
    await h.tracker.onEvent(succeeded())

    expect(h.send).not.toHaveBeenCalled()
  })

  it("never throws when the notifier fails", async () => {
    const h = makeHarness({ sendImpl: async () => ({ ok: false, error: "Telegram HTTP 500" }) })
    h.tracker.onPrompt(prompt(NOTIFY_PROMPT))
    await expect(h.tracker.onEvent(succeeded())).resolves.toBeUndefined()
    expect(h.send).toHaveBeenCalledTimes(1)
  })

  it("never throws when the notifier itself throws", async () => {
    const h = makeHarness({ sendImpl: async () => { throw new Error("boom") } })
    h.tracker.onPrompt(prompt(NOTIFY_PROMPT))
    await expect(h.tracker.onEvent(succeeded())).resolves.toBeUndefined()
  })

  it("falls back to cached data when the session client fails", async () => {
    const client = {
      get: vi.fn(async () => { throw new Error("server down") }),
      context: vi.fn(async () => { throw new Error("server down") }),
      hook: vi.fn(async () => ({ dispose: async () => {} })),
    } as unknown as SessionDomain
    const send = vi.fn(async (_text: string) => ({ ok: true }))
    const tracker = new LifecycleTracker({
      session: client,
      notifier: { enabled: true, send },
      formatter: formatNotification,
      project: "my-project",
      log: vi.fn(),
      now: () => 5_000,
    })
    tracker.onPrompt(prompt(NOTIFY_PROMPT))
    await tracker.onEvent(succeeded())

    expect(send).toHaveBeenCalledTimes(1)
    const text = send.mock.calls[0][0] as string
    expect(text).toContain(NOTIFY_PROMPT)
  })

  it("does not send when telegram is disabled", async () => {
    const send = vi.fn(async () => ({ ok: false }))
    const tracker = new LifecycleTracker({
      session: makeHarness().session,
      notifier: { enabled: false, send },
      formatter: formatNotification,
      project: "my-project",
      log: vi.fn(),
    })
    tracker.onPrompt(prompt(NOTIFY_PROMPT))
    await tracker.onEvent(succeeded())
    expect(send).not.toHaveBeenCalled()
  })

  it("sends a question notification immediately when a form is created", async () => {
    const h = makeHarness({ awaitingFormatter: (data) => formatAwaitingInput(data, { locale: "ru" }) })
    h.tracker.onPrompt(prompt("…"))
    await h.tracker.onEvent(formCreated("q1", "s1", ["Продолжать?"]))

    expect(h.send).toHaveBeenCalledTimes(1)
    const text = h.send.mock.calls[0][0] as string
    expect(text).toContain("⚠️ OpenCode ждёт твой ответ")
    expect(text).toContain("Продолжать?")
    expect(text).toContain("→ Открой OpenCode, чтобы ответить")
  })

  it("does not consume the pending run notification when a question fires", async () => {
    const h = makeHarness({ awaitingFormatter: (data) => formatAwaitingInput(data, { locale: "ru" }) })
    h.tracker.onPrompt(prompt(NOTIFY_PROMPT))
    await h.tracker.onEvent(formCreated("q1", "s1", ["?"]))
    expect(h.send).toHaveBeenCalledTimes(1)

    await h.tracker.onEvent(succeeded())
    expect(h.send).toHaveBeenCalledTimes(2)
    expect(h.send.mock.calls[1][0]).toContain("✅ OpenCode завершил выполнение")
  })

  it("sends a permission notification immediately", async () => {
    const h = makeHarness({ awaitingFormatter: (data) => formatAwaitingInput(data, { locale: "ru" }) })
    await h.tracker.onEvent(permissionAsked("p1", "s1", "bash", ["npm run build"]))

    expect(h.send).toHaveBeenCalledTimes(1)
    const text = h.send.mock.calls[0][0] as string
    expect(text).toContain("🔐 OpenCode запрашивает разрешение")
    expect(text).toContain("Действие:\nbash")
    expect(text).toContain("Цели:\nnpm run build")
  })

  it("dedupes by request id and applies a 30 s cooldown per session", async () => {
    const send = vi.fn(async () => ({ ok: true }))
    let clock = 0
    const tracker = new LifecycleTracker({
      session: makeHarness().session,
      notifier: { enabled: true, send },
      formatter: formatNotification,
      awaitingFormatter: (data) => formatAwaitingInput(data, { locale: "ru" }),
      project: "my-project",
      log: vi.fn(),
      now: () => clock,
    })

    await tracker.onEvent(formCreated("a", "s1", ["?"]))
    await tracker.onEvent(formCreated("a", "s1", ["?"])) // same request id → dedupe
    await tracker.onEvent(formCreated("b", "s1", ["?"])) // within cooldown → skip
    expect(send).toHaveBeenCalledTimes(1)

    clock = 30_000 // exactly at cooldown boundary → allowed (30_000 - 0 >= 30_000)
    await tracker.onEvent(formCreated("b", "s1", ["?"]))
    expect(send).toHaveBeenCalledTimes(2)

    clock = 40_000
    await tracker.onEvent(formCreated("c", "s1", ["?"])) // 10 s since last send → within cooldown
    expect(send).toHaveBeenCalledTimes(2)

    clock = 70_001
    await tracker.onEvent(formCreated("c", "s1", ["?"])) // new request id, cooldown elapsed
    expect(send).toHaveBeenCalledTimes(3)
  })

  it("tracks awaiting state per session", async () => {
    const send = vi.fn(async () => ({ ok: true }))
    const tracker = new LifecycleTracker({
      session: makeHarness().session,
      notifier: { enabled: true, send },
      formatter: formatNotification,
      awaitingFormatter: (data) => formatAwaitingInput(data, { locale: "ru" }),
      project: "my-project",
      log: vi.fn(),
      now: () => 0,
    })

    await tracker.onEvent(formCreated("a", "s1", ["?"]))
    await tracker.onEvent(formCreated("b", "s2", ["?"])) // same clock, different session → allowed
    expect(send).toHaveBeenCalledTimes(2)
  })

  it("never throws when the awaiting-input send fails", async () => {
    const h = makeHarness({
      awaitingFormatter: (data) => formatAwaitingInput(data, { locale: "ru" }),
      sendImpl: async () => { throw new Error("boom") },
    })
    await expect(
      h.tracker.onEvent(formCreated("q1", "s1", ["?"])),
    ).resolves.toBeUndefined()
  })

  it("ignores legacy question events without breaking", async () => {
    const h = makeHarness({ awaitingFormatter: (data) => formatAwaitingInput(data, { locale: "ru" }) })
    await h.tracker.onEvent({
      type: "question.v2.asked",
      properties: {
        id: "q1",
        sessionID: "s1",
        questions: [{ question: "Продолжать?" }],
      },
    })

    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.send.mock.calls[0][0]).toContain("Продолжать?")
  })
})
