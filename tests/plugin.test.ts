import { existsSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createTelegramNotify } from "../.opencode/plugins/telegram-notify.js"
import { resolveLogFile } from "../.opencode/plugins/telegram-notify/config.js"
import type {
  PluginContext,
  PromptEvent,
  SessionMessage,
} from "../.opencode/plugins/telegram-notify/types.js"

const NOTIFY_PROMPT = "Проанализируй почему падают integration tests и исправь. Когда закончишь, сообщи мне в Telegram."
const PLAIN_PROMPT = "Покажи текущую структуру проекта."

function userMessage(id: string, text: string): SessionMessage {
  return { id, type: "user", text, time: { created: 0 } }
}

function assistantMessage(id: string, text: string): SessionMessage {
  return {
    id,
    type: "assistant",
    content: [{ type: "text", text }],
    model: { providerID: "anthropic", id: "claude" },
    time: { created: 0, completed: 1 },
  }
}

interface Harness {
  fetchImpl: ReturnType<typeof vi.fn>
  session: {
    get: ReturnType<typeof vi.fn>
    context: ReturnType<typeof vi.fn>
    hook: ReturnType<typeof vi.fn>
  }
  prompt: (text: string) => void
  emit: (event: unknown) => Promise<void>
  cleanup: () => Promise<void>
}

let activeCleanup: (() => Promise<void>) | undefined

/** A tiny push-based async iterable that mimics `ctx.event.subscribe()`. */
function createEventStream() {
  /** @type {unknown[]} */
  const values: unknown[] = []
  let pending: ((result: IteratorResult<unknown>) => void) | undefined
  let closed = false

  const close = () => {
    closed = true
    if (pending) {
      const resolve = pending
      pending = undefined
      resolve({ value: undefined, done: true })
    }
  }

  const subscribe = vi.fn((options?: { signal?: AbortSignal }) => {
    const signal = options?.signal
    if (signal) {
      if (signal.aborted) close()
      else signal.addEventListener("abort", close, { once: true })
    }

    return {
      [Symbol.asyncIterator]() {
        return {
          next() {
            if (values.length > 0) {
              return Promise.resolve({ value: values.shift(), done: false })
            }
            if (closed) {
              return Promise.resolve({ value: undefined, done: true })
            }
            return new Promise<IteratorResult<unknown>>((resolve) => {
              pending = resolve
            })
          },
          return() {
            close()
            return Promise.resolve({ value: undefined, done: true })
          },
        }
      },
    } as AsyncIterable<unknown>
  })

  return {
    subscribe,
    push(event: unknown) {
      if (pending) {
        const resolve = pending
        pending = undefined
        resolve({ value: event, done: false })
      } else {
        values.push(event)
      }
    },
    close,
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

async function makePlugin(messages: SessionMessage[] = []): Promise<Harness> {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
  const promptHandlers: Array<(event: PromptEvent) => void> = []
  const stream = createEventStream()

  const session = {
    get: vi.fn(async () => ({
      id: "s1",
      title: "My Session",
      location: { directory: "C:\\proj" },
      model: { providerID: "anthropic", id: "claude" },
      time: { created: 0, updated: 1 },
    })),
    context: vi.fn(async () => messages),
    hook: vi.fn(async (name: string, handler: (event: PromptEvent) => void) => {
      if (name === "prompt") promptHandlers.push(handler)
      return { dispose: async () => {} }
    }),
  }

  const ctx = {
    location: {
      directory: "C:\\proj",
      project: { id: "proj-id", directory: "C:\\proj", canonical: "C:\\proj" },
    },
    session,
    event: { subscribe: stream.subscribe },
    options: {},
  } as unknown as PluginContext

  const cleanup = await createTelegramNotify(ctx, { fetchImpl })
  const harness: Harness = {
    fetchImpl,
    session,
    prompt: (text: string) => {
      for (const handler of promptHandlers) {
        handler({
          sessionID: "s1",
          messageID: "m1",
          prompt: { text },
          delivery: "steer",
        })
      }
    },
    emit: async (event: unknown) => {
      stream.push(event)
      await flush()
    },
    cleanup: async () => {
      cleanup()
      stream.close()
      await flush()
    },
  }
  activeCleanup = harness.cleanup
  return harness
}

function telegramRequests(fetchImpl: ReturnType<typeof vi.fn>): Array<{ url: string; body: { chat_id: string; text: string } }> {
  return fetchImpl.mock.calls.map(([url, init]) => ({
    url: url as string,
    body: JSON.parse((init as RequestInit).body as string),
  }))
}

const succeeded = (sessionID = "s1") => ({
  type: "session.execution.succeeded",
  data: { sessionID },
})

const failed = (sessionID = "s1") => ({
  type: "session.execution.failed",
  data: {
    sessionID,
    error: { type: "APIError", message: "boom" },
  },
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

/** Point the home-directory env vars at a throwaway dir so the default log path is isolated. */
function isolateHome(): { dir: string; saved: Record<string, string | undefined> } {
  const dir = join(tmpdir(), `telegram-notify-home-${Date.now()}`)
  const keys = ["USERPROFILE", "HOME", "XDG_DATA_HOME", "XDG_CONFIG_HOME"] as const
  const saved: Record<string, string | undefined> = {}
  for (const key of keys) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  process.env.USERPROFILE = dir
  process.env.HOME = dir
  return { dir, saved }
}

function restoreHome(saved: Record<string, string | undefined>): void {
  for (const key of ["USERPROFILE", "HOME", "XDG_DATA_HOME", "XDG_CONFIG_HOME"]) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
}

describe("telegram-notify plugin (V2 integration)", () => {
  const originalEnv: Record<string, string | undefined> = {}
  beforeEach(() => {
    originalEnv.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
    originalEnv.TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID
    originalEnv.TELEGRAM_ENABLED = process.env.TELEGRAM_ENABLED
    originalEnv.TELEGRAM_LANGUAGE = process.env.TELEGRAM_LANGUAGE
    process.env.TELEGRAM_BOT_TOKEN = "123456:TEST-TOKEN"
    process.env.TELEGRAM_CHAT_ID = "42"
    process.env.TELEGRAM_ENABLED = "true"
    process.env.TELEGRAM_LANGUAGE = "ru"
  })
  afterEach(async () => {
    await activeCleanup?.()
    activeCleanup = undefined
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    if (originalEnv.TELEGRAM_BOT_TOKEN === undefined) delete process.env.TELEGRAM_BOT_TOKEN
    else process.env.TELEGRAM_BOT_TOKEN = originalEnv.TELEGRAM_BOT_TOKEN
    if (originalEnv.TELEGRAM_CHAT_ID === undefined) delete process.env.TELEGRAM_CHAT_ID
    else process.env.TELEGRAM_CHAT_ID = originalEnv.TELEGRAM_CHAT_ID
    if (originalEnv.TELEGRAM_ENABLED === undefined) delete process.env.TELEGRAM_ENABLED
    else process.env.TELEGRAM_ENABLED = originalEnv.TELEGRAM_ENABLED
    if (originalEnv.TELEGRAM_LANGUAGE === undefined) delete process.env.TELEGRAM_LANGUAGE
    else process.env.TELEGRAM_LANGUAGE = originalEnv.TELEGRAM_LANGUAGE
  })

  it("sends a Telegram notification after a prompt completes", async () => {
    const harness = await makePlugin([
      userMessage("m1", NOTIFY_PROMPT),
      assistantMessage("m2", "Integration tests исправлены."),
    ])

    harness.prompt(NOTIFY_PROMPT)
    await harness.emit(succeeded())

    expect(harness.fetchImpl).toHaveBeenCalledTimes(1)
    const [request] = telegramRequests(harness.fetchImpl)
    expect(request.url).toBe("https://api.telegram.org/bot123456:TEST-TOKEN/sendMessage")
    expect(request.body.chat_id).toBe("42")
    expect(request.body.text).toContain("✅ OpenCode завершил выполнение")
    expect(request.body.text).toContain(NOTIFY_PROMPT)
    expect(request.body.text).toContain("Integration tests исправлены.")
  })

  it("uses the selected language for the notification", async () => {
    process.env.TELEGRAM_LANGUAGE = "en"
    const promptText = "Fix the integration tests."
    const harness = await makePlugin([
      userMessage("m1", promptText),
      assistantMessage("m2", "Integration tests fixed."),
    ])

    harness.prompt(promptText)
    await harness.emit(succeeded())

    expect(harness.fetchImpl).toHaveBeenCalledTimes(1)
    const [request] = telegramRequests(harness.fetchImpl)
    expect(request.body.text).toContain("✅ OpenCode completed successfully")
    expect(request.body.text).toContain("Request:")
    expect(request.body.text).toContain("Result:")
    expect(request.body.text).toContain("Integration tests fixed.")
  })

  it("re-reads TELEGRAM_LANGUAGE for every notification", async () => {
    const harness = await makePlugin([
      userMessage("m1", "Исправь тесты."),
      assistantMessage("m2", "Готово."),
    ])

    // The plugin was created while TELEGRAM_LANGUAGE was "ru" (see beforeEach);
    // changing it now must affect the next message without recreating the plugin.
    process.env.TELEGRAM_LANGUAGE = "en"

    harness.prompt("Исправь тесты.")
    await harness.emit(succeeded())

    expect(harness.fetchImpl).toHaveBeenCalledTimes(1)
    const [request] = telegramRequests(harness.fetchImpl)
    expect(request.body.text).toContain("✅ OpenCode completed successfully")
  })

  it("uses Spanish for notifications when TELEGRAM_LANGUAGE=es", async () => {
    process.env.TELEGRAM_LANGUAGE = "es"
    const harness = await makePlugin([
      userMessage("m1", "Corrige las pruebas."),
      assistantMessage("m2", "Listo."),
    ])

    harness.prompt("Corrige las pruebas.")
    await harness.emit(succeeded())

    expect(harness.fetchImpl).toHaveBeenCalledTimes(1)
    const [request] = telegramRequests(harness.fetchImpl)
    expect(request.body.text).toContain("✅ OpenCode completó la ejecución correctamente")
    expect(request.body.text).toContain("Solicitud:")
    expect(request.body.text).toContain("Listo.")
  })

  it("sends an error notification when the run fails", async () => {
    const harness = await makePlugin()
    harness.prompt(NOTIFY_PROMPT)
    await harness.emit(failed())

    expect(harness.fetchImpl).toHaveBeenCalledTimes(1)
    const [request] = telegramRequests(harness.fetchImpl)
    expect(request.body.text).toContain("❌ OpenCode завершил работу с ошибкой")
    expect(request.body.text).toContain("boom")
  })

  it("sends an immediate notification when a form waits for the user", async () => {
    const harness = await makePlugin()
    harness.prompt(NOTIFY_PROMPT)
    await harness.emit(formCreated("q1", "s1", ["Продолжать?"]))

    expect(harness.fetchImpl).toHaveBeenCalledTimes(1)
    const [request] = telegramRequests(harness.fetchImpl)
    expect(request.body.text).toContain("⚠️ OpenCode ждёт твой ответ")
    expect(request.body.text).toContain("Продолжать?")
  })

  it("notifies even for a plain prompt (notifications are always on)", async () => {
    const harness = await makePlugin()
    harness.prompt(PLAIN_PROMPT)
    await harness.emit(succeeded())
    expect(harness.fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("sends exactly once for one prompt (one-shot)", async () => {
    const harness = await makePlugin()
    harness.prompt(NOTIFY_PROMPT)
    await harness.emit(succeeded())
    await harness.emit(succeeded())
    await harness.emit({ type: "session.idle", data: { sessionID: "s1" } })
    expect(harness.fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("does not break opencode when the session client fails", async () => {
    const harness = await makePlugin()
    harness.session.get.mockRejectedValue(new Error("server down"))
    harness.session.context.mockRejectedValue(new Error("server down"))

    expect(() => harness.prompt(NOTIFY_PROMPT)).not.toThrow()
    await expect(harness.emit(succeeded())).resolves.toBeUndefined()
    expect(harness.fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("never logs the bot token", async () => {
    const { dir, saved } = isolateHome()
    const savedVitest = process.env.VITEST
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      delete process.env.VITEST
      const harness = await makePlugin([
        userMessage("m1", NOTIFY_PROMPT),
        assistantMessage("m2", "Готово."),
      ])
      harness.prompt(NOTIFY_PROMPT)
      await harness.emit(succeeded())

      const consoleOutput = [logSpy, warnSpy, errorSpy]
        .flatMap((spy) => spy.mock.calls.flat())
        .map((value) => JSON.stringify(value))
        .join("\n")
      expect(consoleOutput).not.toContain("123456:TEST-TOKEN")

      const content = readFileSync(resolveLogFile(process.env), "utf8")
      expect(content).not.toContain("123456:TEST-TOKEN")
    } finally {
      if (savedVitest === undefined) delete process.env.VITEST
      else process.env.VITEST = savedVitest
      restoreHome(saved)
      rmSync(dir, { force: true, recursive: true })
    }
  })

  it("does not write the log file when running under vitest", async () => {
    const { dir, saved } = isolateHome()
    try {
      const harness = await makePlugin()
      harness.prompt(PLAIN_PROMPT)
      await harness.emit(succeeded())
      expect(existsSync(resolveLogFile(process.env))).toBe(false)
    } finally {
      restoreHome(saved)
      rmSync(dir, { force: true, recursive: true })
    }
  })

  it("writes the full trace to the default log file outside vitest", async () => {
    const { dir, saved } = isolateHome()
    const savedVitest = process.env.VITEST
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      delete process.env.VITEST
      const harness = await makePlugin()
      harness.prompt(PLAIN_PROMPT)
      await harness.emit(succeeded())

      const logPath = resolveLogFile(process.env)
      expect(existsSync(logPath)).toBe(true)
      const content = readFileSync(logPath, "utf8")
      expect(content).toContain("Telegram notification enabled")
      expect(content).toContain("notification queued for run")
      expect(content).toContain("notifier: telegram send ok")
      expect(content).toContain("telegram notification sent")
    } finally {
      if (savedVitest === undefined) delete process.env.VITEST
      else process.env.VITEST = savedVitest
      restoreHome(saved)
      rmSync(dir, { force: true, recursive: true })
    }
  })
})
