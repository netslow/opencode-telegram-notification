import { describe, expect, it, vi } from "vitest"
import { Agent as HttpAgent, createServer } from "node:http"
import type { Server } from "node:http"
import { Agent as HttpsAgent } from "node:https"
import { connect } from "node:net"
import type { AddressInfo } from "node:net"
import {
  createProxyAgent,
  request,
  resolveProxy,
  shouldBypassProxy,
  TelegramNotifier,
} from "../.opencode/plugins/telegram-notify/notifier.js"
import type { TelegramConfig } from "../.opencode/plugins/telegram-notify/types.js"

function config(overrides: Partial<TelegramConfig> = {}): TelegramConfig {
  return {
    enabled: true,
    botToken: "123456:TEST-TOKEN",
    chatId: "999",
    timeoutMs: 5_000,
    retries: 2,
    retryDelayMs: 1,
    ...overrides,
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1")
  await new Promise<void>((resolve) => server.once("listening", resolve))
  const address = server.address() as AddressInfo
  return address.port
}

describe("TelegramNotifier", () => {
  it("skips when disabled", async () => {
    const notifier = new TelegramNotifier(config({ enabled: false }))
    const result = await notifier.send("hello")
    expect(result.ok).toBe(false)
    expect(result.skipped).toBe(true)
  })

  it("sends a message on success", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse(200, { ok: true }))
    const logged: string[] = []
    const notifier = new TelegramNotifier(config(), { fetchImpl, log: (m) => logged.push(m) })

    const result = await notifier.send("hello")
    expect(result.ok).toBe(true)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe("https://api.telegram.org/bot123456:TEST-TOKEN/sendMessage")
    const body = JSON.parse(init.body as string)
    expect(body.chat_id).toBe("999")
    expect(body.text).toBe("hello")

    expect(logged.join("\n")).not.toContain("123456:TEST-TOKEN")
  })

  it("reports HTTP errors and does not throw", async () => {
    const sleep = vi.fn(async () => {})
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse(502, { error: "Bad Gateway" }))
    const notifier = new TelegramNotifier(config({ retries: 1, retryDelayMs: 1 }), { fetchImpl, sleep })

    const result = await notifier.send("hello")
    expect(result.ok).toBe(false)
    expect(result.error).toContain("Telegram HTTP 502")
    expect(fetchImpl).toHaveBeenCalledTimes(2) // initial + 1 retry
  })

  it("reports network errors and does not throw", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed: https://api.telegram.org/bot123456:TEST-TOKEN/sendMessage")
    })
    const logged: string[] = []
    const notifier = new TelegramNotifier(config({ retries: 0 }), { fetchImpl, log: (m) => logged.push(m) })

    const result = await notifier.send("hello")
    expect(result.ok).toBe(false)
    expect(result.error).toContain("network error")
    // token must not leak into logs
    expect(logged.join("\n")).not.toContain("123456:TEST-TOKEN")
  })

  it("reports Telegram API errors from the response body", async () => {
    const fetchImpl = vi.fn(
      async () => jsonResponse(400, { ok: false, description: "Bad Request: chat not found" }),
    )
    const notifier = new TelegramNotifier(config({ retries: 0 }), { fetchImpl })

    const result = await notifier.send("hello")
    expect(result.ok).toBe(false)
    expect(result.error).toContain("chat not found")
  })

  it("aborts on timeout and reports a network error", async () => {
    vi.useFakeTimers()
    try {
      const fetchImpl = vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new Error("aborted")))
          }),
      )
      const notifier = new TelegramNotifier(config({ timeoutMs: 1_000, retries: 0 }), { fetchImpl })

      const pending = notifier.send("hello")
      await vi.advanceTimersByTimeAsync(2_000)
      const result = await pending
      expect(result.ok).toBe(false)
      expect(result.error).toContain("network error")
    } finally {
      vi.useRealTimers()
    }
  })

  it("respects the retry budget with backoff", async () => {
    const sleep = vi.fn(async () => {})
    const fetchImpl = vi.fn(async () => jsonResponse(503, { ok: false }))
    const notifier = new TelegramNotifier(config({ retries: 3, retryDelayMs: 100 }), { fetchImpl, sleep })

    const result = await notifier.send("hello")
    expect(result.ok).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(4) // initial + 3 retries
    expect(sleep).toHaveBeenCalledTimes(3)
  })
})

describe("shouldBypassProxy", () => {
  it("applies NO_PROXY matching rules", () => {
    expect(shouldBypassProxy("*", "api.telegram.org", 443)).toBe(true)
    expect(shouldBypassProxy("api.telegram.org", "api.telegram.org", 443)).toBe(true)
    expect(shouldBypassProxy("api.telegram.org", "sub.api.telegram.org", 443)).toBe(true)
    expect(shouldBypassProxy(".telegram.org", "api.telegram.org", 443)).toBe(true)
    expect(shouldBypassProxy("*.telegram.org", "api.telegram.org", 443)).toBe(true)
    expect(shouldBypassProxy("telegram.org", "api.telegram.org", 443)).toBe(true)
    expect(shouldBypassProxy("api.telegram.org:443", "api.telegram.org", 443)).toBe(true)
    expect(shouldBypassProxy("api.telegram.org:443", "api.telegram.org", 80)).toBe(false)
    expect(shouldBypassProxy("10.0.0.0/8", "10.1.2.3", 443)).toBe(true)
    expect(shouldBypassProxy("10.0.0.0/8", "11.1.2.3", 443)).toBe(false)
    expect(shouldBypassProxy(undefined, "api.telegram.org", 443)).toBe(false)
    expect(shouldBypassProxy("  localhost, example.com  ", "localhost", 443)).toBe(true)
  })
})

describe("resolveProxy", () => {
  it("picks the scheme-specific proxy and honors NO_PROXY", () => {
    const proxy = {
      httpProxy: "http://hp:8080",
      httpsProxy: "http://hsp:8080",
      noProxy: "skip.me",
    }
    expect(resolveProxy(proxy, "https:", "api.telegram.org", 443)).toBe("http://hsp:8080")
    expect(resolveProxy(proxy, "http:", "example.com", 80)).toBe("http://hp:8080")
    expect(resolveProxy(proxy, "https:", "skip.me", 443)).toBeUndefined()
    expect(resolveProxy(undefined, "https:", "api.telegram.org", 443)).toBeUndefined()
    expect(resolveProxy({ httpsProxy: "http://hsp:8080" }, "https:", "a.b", 443)).toBe("http://hsp:8080")
    expect(resolveProxy({ httpProxy: "http://hp:8080" }, "https:", "a.b", 443)).toBe("http://hp:8080")
  })
})

describe("createProxyAgent", () => {
  it("builds a CONNECT-tunneling agent for http and https targets", () => {
    const httpAgent = createProxyAgent("http://127.0.0.1:1080", "http:")
    expect(httpAgent).toBeInstanceOf(HttpAgent)
    expect(typeof (httpAgent as HttpAgent).createConnection).toBe("function")

    const httpsAgent = createProxyAgent("http://127.0.0.1:1080", "https:")
    expect(httpsAgent).toBeInstanceOf(HttpsAgent)
  })
})

describe("request transport", () => {
  it("sends a plain HTTP request without a proxy", async () => {
    const server = createServer((req, res) => {
      let body = ""
      req.on("data", (chunk) => (body += chunk))
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json")
        res.end(JSON.stringify({ ok: true, received: JSON.parse(body || "{}") }))
      })
    })
    const port = await listen(server)
    try {
      const result = await request(
        `http://127.0.0.1:${port}/x?q=1`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ a: 1 }),
        },
        undefined,
      )
      expect(result.status).toBe(200)
      expect(result.ok).toBe(true)
      expect((await result.json()) as { ok?: boolean }).toMatchObject({
        ok: true,
        received: { a: 1 },
      })
    } finally {
      server.close()
    }
  })

  it("routes a request through a CONNECT proxy", async () => {
    const target = createServer((_req, res) => {
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({ proxied: true }))
    })
    const targetPort = await listen(target)

    let sawConnect = false
    const proxy = createServer()
    proxy.on("connect", (req, clientSocket) => {
      sawConnect = true
      const [host, portRaw] = (req.url ?? "").split(":")
      const targetSocket = connect(Number(portRaw), host, () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
        clientSocket.pipe(targetSocket)
        targetSocket.pipe(clientSocket)
      })
      targetSocket.on("error", () => clientSocket.destroy())
    })
    const proxyPort = await listen(proxy)

    try {
      const result = await request(
        `http://127.0.0.1:${targetPort}/x`,
        { method: "GET" },
        { httpProxy: `http://127.0.0.1:${proxyPort}` },
      )
      expect(sawConnect).toBe(true)
      expect(result.status).toBe(200)
      expect((await result.json()) as { proxied?: boolean }).toMatchObject({ proxied: true })
    } finally {
      proxy.close()
      target.close()
    }
  })

  it("honors AbortSignal", async () => {
    const server = createServer(() => {})
    const port = await listen(server)
    try {
      const controller = new AbortController()
      const pending = request(
        `http://127.0.0.1:${port}/x`,
        { method: "GET", signal: controller.signal },
        undefined,
      )
      setTimeout(() => controller.abort(new Error("aborted")), 10)
      await expect(pending).rejects.toThrow("aborted")
    } finally {
      server.close()
    }
  })
})
