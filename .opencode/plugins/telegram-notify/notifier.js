/**
 * TelegramNotifier — isolated Telegram Bot API client.
 *
 * Responsibilities:
 *   - POST to the official Telegram Bot API `sendMessage` endpoint
 *   - per-request timeout via AbortController
 *   - bounded retries with a small delay
 *   - HTTP(S) proxy support via HTTP_PROXY / HTTPS_PROXY / NO_PROXY
 *     (CONNECT tunnel built on node:net / node:tls — no npm dependencies)
 *   - HTTP errors, Telegram API errors and network errors are returned as a
 *     `SendResult`, never thrown
 *   - the bot token is never logged
 *
 * The transport layer uses only Node built-ins (node:http, node:https,
 * node:net, node:tls), so the plugin has no runtime dependencies and works
 * when copied to any directory (e.g. the global ~/.config/opencode).
 *
 * Plain JavaScript (JSDoc types) so the plugin loads under OpenCode Desktop,
 * whose Node runtime cannot import `.ts` files.
 */
import { Agent as HttpAgent, request as httpRequest } from "node:http"
import { Agent as HttpsAgent, request as httpsRequest } from "node:https"
import { connect as tcpConnect } from "node:net"
import { connect as tlsConnect } from "node:tls"

/**
 * Minimal response shape returned by the built-in transport. A real `Response`
 * (from an injected `fetchImpl`) is structurally compatible.
 *
 * @typedef {object} FetchResponse
 * @property {number} status
 * @property {boolean} ok
 * @property {() => Promise<unknown>} json
 */

/**
 * @typedef {(url: string, init: RequestInit) => Promise<FetchResponse>} FetchLike
 */

/**
 * @typedef {object} TelegramNotifierOptions
 * @property {FetchLike} [fetchImpl]
 * @property {(ms: number) => Promise<void>} [sleep]
 * @property {(message: string) => void} [log]
 */

const TELEGRAM_API = "https://api.telegram.org"

/**
 * @param {string} token
 * @returns {string}
 */
export function buildTelegramUrl(token) {
  return `${TELEGRAM_API}/bot${token}/sendMessage`
}

export class TelegramNotifier {
  /**
   * @param {import("./types.js").TelegramConfig} config
   * @param {TelegramNotifierOptions} [options]
   */
  constructor(config, options = {}) {
    this.config = config
    /** @type {FetchLike} */
    const defaultFetchImpl = (url, init) => request(url, init, config.proxy)
    this.fetchImpl = options.fetchImpl ?? defaultFetchImpl
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.log = options.log ?? (() => {})
  }

  /** True when the notifier is configured and able to send. */
  get enabled() {
    return this.config.enabled
  }

  /**
   * Send a message. Never throws; every failure is folded into `SendResult`.
   *
   * @param {string} text
   * @returns {Promise<import("./types.js").SendResult>}
   */
  async send(text) {
    if (!this.config.enabled) {
      return { ok: false, skipped: true, reason: "telegram disabled" }
    }
    if (!text.trim()) {
      return { ok: false, reason: "empty message" }
    }
    const token = /** @type {string} */ (this.config.botToken)
    const chatId = /** @type {string} */ (this.config.chatId)
    const url = buildTelegramUrl(token)

    let lastError

    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      if (attempt > 0) {
        await this.sleep(this.config.retryDelayMs)
      }
      const result = await this.trySendOnce(url, token, chatId, text)
      if (result.ok) return result
      lastError = result.error
      if (!result.retryable) return result
    }

    return { ok: false, error: lastError ?? "telegram send failed" }
  }

  /**
   * @param {string} url
   * @param {string} token
   * @param {string} chatId
   * @param {string} text
   * @returns {Promise<import("./types.js").SendResult & { retryable: boolean }>}
   */
  async trySendOnce(url, token, chatId, text) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      })
      const status = response.status
      const retryable = status === 408 || status === 429 || status >= 500

      let body
      try {
        body = await response.json()
      } catch {
        body = undefined
      }

      /** @type {{ ok?: boolean, description?: string } | undefined} */
      const apiBody = /** @type {{ ok?: boolean, description?: string } | undefined} */ (body)

      // Prefer the Telegram-provided description (e.g. "chat not found") over
      // a bare HTTP status code whenever the API body is available.
      if (apiBody?.ok === false) {
        const message = `Telegram API error: ${apiBody.description ?? "unknown"}`
        this.log(`telegram send failed: ${message}`)
        return { ok: false, error: message, retryable }
      }

      if (!response.ok) {
        const message = `Telegram HTTP ${status}`
        this.log(`telegram send failed: ${message}`)
        return { ok: false, error: message, retryable }
      }

      this.log("telegram send ok")
      return { ok: true, retryable: false }
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      const safe = raw.split(token).join("***")
      this.log(`telegram network error: ${safe}`)
      return { ok: false, error: `network error: ${safe}`, retryable: true }
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * Minimal fetch-like transport on Node built-ins. Returns a response object
 * with just the fields `TelegramNotifier` consumes (`status`, `ok`, `json`).
 *
 * `init.headers` should be a plain object; `init.body` should be a string.
 *
 * @param {string} url
 * @param {RequestInit} init
 * @param {import("./types.js").TelegramConfig["proxy"]} [proxyConfig]
 * @returns {Promise<FetchResponse>}
 */
export async function request(url, init, proxyConfig) {
  const parsed = new URL(url)
  const protocol = parsed.protocol === "http:" ? "http:" : "https:"
  const hostname = parsed.hostname
  const port = Number(parsed.port || (protocol === "https:" ? 443 : 80))
  const body = typeof init?.body === "string" ? init.body : undefined

  /** @type {Record<string, string>} */
  const headers = {}
  if (init?.headers && typeof (/** @type {unknown} */ (init.headers)) === "object") {
    const source = /** @type {Record<string, unknown>} */ (init.headers)
    for (const key of Object.keys(source)) {
      const value = source[key]
      headers[key] = Array.isArray(value) ? value.join(", ") : String(value)
    }
  }
  if (body !== undefined) {
    headers["Content-Length"] = String(Buffer.byteLength(body))
  }

  /** @type {import("node:https").RequestOptions} */
  const options = {
    protocol,
    hostname,
    port,
    method: init?.method ?? "GET",
    path: parsed.pathname + parsed.search,
    headers,
  }

  const proxy = resolveProxy(proxyConfig, protocol, hostname, port)
  if (proxy !== undefined) {
    options.agent = createProxyAgent(proxy, protocol)
  }

  const requester = protocol === "https:" ? httpsRequest : httpRequest

  return new Promise((resolve, reject) => {
    let settled = false
    const signal = init?.signal
    /** @type {import("node:http").ClientRequest} */
    let req
    const onAbort = () => {
      const reason = signal?.reason
      req.destroy(reason instanceof Error ? reason : new Error("aborted"))
    }
    const cleanup = () => {
      if (signal) signal.removeEventListener("abort", onAbort)
    }

    req = requester(options, (res) => {
      /** @type {Uint8Array[]} */
      const chunks = []
      res.on("data", (chunk) => chunks.push(chunk))
      res.on("error", (error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      })
      res.on("end", () => {
        if (settled) return
        settled = true
        cleanup()
        const text = Buffer.concat(chunks).toString("utf8")
        const status = res.statusCode ?? 0
        resolve({
          status,
          ok: status >= 200 && status < 300,
          json: async () => {
            try {
              return JSON.parse(text)
            } catch (error) {
              throw new Error(
                `invalid JSON response: ${error instanceof Error ? error.message : String(error)}`,
              )
            }
          },
        })
      })
    })

    req.on("error", (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    })
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener("abort", onAbort)
    }
    if (body !== undefined) req.write(body)
    req.end()
  })
}

/**
 * Pick the proxy for a request, honoring NO_PROXY.
 *
 * @param {import("./types.js").TelegramConfig["proxy"] | undefined} proxy
 * @param {string} protocol "http:" or "https:"
 * @param {string} hostname
 * @param {number} port
 * @returns {string | undefined}
 */
export function resolveProxy(proxy, protocol, hostname, port) {
  if (!proxy) return undefined
  if (shouldBypassProxy(proxy.noProxy, hostname, port)) return undefined
  if (protocol === "https:") return proxy.httpsProxy ?? proxy.httpProxy
  return proxy.httpProxy ?? proxy.httpsProxy
}

/**
 * NO_PROXY matching: `*`, exact host, dot-prefixed and wildcard domains,
 * `host:port`, and IPv4 CIDR entries.
 *
 * @param {string | undefined} noProxy
 * @param {string} hostname
 * @param {number} port
 * @returns {boolean}
 */
export function shouldBypassProxy(noProxy, hostname, port) {
  if (!noProxy) return false
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase()
  for (const raw of noProxy.split(",")) {
    const entry = raw.trim()
    if (!entry) continue
    if (entry === "*") return true
    if (entry.includes("/")) {
      if (cidrContains(entry, host)) return true
      continue
    }
    const parsed = parseNoProxyEntry(entry)
    if (parsed.port !== undefined && parsed.port !== port) continue
    const entryHost = parsed.host.toLowerCase()
    if (entryHost.startsWith("*.")) {
      const suffix = entryHost.slice(2)
      if (host === suffix || host.endsWith("." + suffix)) return true
      continue
    }
    if (host === entryHost) return true
    const base = entryHost.startsWith(".") ? entryHost.slice(1) : entryHost
    if (base && host.endsWith("." + base)) return true
  }
  return false
}

/**
 * @param {string} entry
 * @returns {{ host: string, port: number | undefined }}
 */
function parseNoProxyEntry(entry) {
  if (entry.startsWith("[")) {
    const close = entry.indexOf("]")
    if (close === -1) return { host: entry, port: undefined }
    const rest = entry.slice(close + 1)
    const port = parsePort(rest.startsWith(":") ? rest.slice(1) : "")
    return { host: entry.slice(0, close + 1), port }
  }
  const colon = entry.indexOf(":")
  if (colon === -1) return { host: entry, port: undefined }
  return { host: entry.slice(0, colon), port: parsePort(entry.slice(colon + 1)) }
}

/**
 * @param {string} raw
 * @returns {number | undefined}
 */
function parsePort(raw) {
  if (!raw) return undefined
  const port = Number(raw)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined
}

/**
 * IPv4 CIDR containment check.
 *
 * @param {string} cidr e.g. "10.0.0.0/8"
 * @param {string} ip
 * @returns {boolean}
 */
function cidrContains(cidr, ip) {
  const slash = cidr.indexOf("/")
  if (slash === -1) return false
  const base = ipv4ToInt(cidr.slice(0, slash))
  const target = ipv4ToInt(ip)
  if (base === null || target === null) return false
  const bits = Number(cidr.slice(slash + 1))
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return (base & mask) === (target & mask)
}

/**
 * @param {string} ip
 * @returns {number | null}
 */
function ipv4ToInt(ip) {
  const parts = ip.split(".")
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const num = Number(part)
    if (num < 0 || num > 255) return null
    value = value * 256 + num
  }
  return value
}

/**
 * Build an http(s) Agent whose connections are CONNECT tunnels through the
 * proxy. The agent is passed to node:http/https `request`, so `options.host` /
 * `options.port` stay the real target while the tunnel carries the traffic
 * (wrapped in TLS when the target is https).
 *
 * @param {string} proxyUrl
 * @param {"http:" | "https:"} targetProtocol
 * @returns {HttpAgent | HttpsAgent}
 */
export function createProxyAgent(proxyUrl, targetProtocol) {
  const targetSecure = targetProtocol === "https:"
  const Agent = targetSecure ? HttpsAgent : HttpAgent
  const agent = new Agent({ keepAlive: false })
  /**
   * The `createConnection` option is not honoured by the Agent constructor,
   * so it is assigned after construction (Agent.createSocket calls it).
   *
   * @param {import("node:http").ClientRequestArgs} options
   * @param {(err: Error | null, socket?: import("node:net").Socket) => void} callback
   */
  const createConnection = (options, callback) => {
    tunnel(proxyUrl, String(options.host ?? ""), Number(options.port ?? 443), targetSecure)
      .then((socket) => callback(null, socket))
      .catch((error) => callback(error))
  }
  agent.createConnection = /** @type {typeof agent.createConnection} */ (
    /** @type {unknown} */ (createConnection)
  )
  return agent
}

/**
 * Open a CONNECT tunnel to `targetHost:targetPort` through `proxyUrl`, then
 * (optionally) wrap it in TLS. Resolves with a connected socket.
 *
 * @param {string} proxyUrl
 * @param {string} targetHost
 * @param {number} targetPort
 * @param {boolean} secureTarget Wrap the tunnel in TLS (target is https).
 * @returns {Promise<import("node:net").Socket>}
 */
function tunnel(proxyUrl, targetHost, targetPort, secureTarget) {
  return new Promise((resolve, reject) => {
    let proxy
    try {
      proxy = new URL(proxyUrl)
    } catch (error) {
      reject(error)
      return
    }
    const proxyHost = proxy.hostname
    const proxyPort = Number(proxy.port || (proxy.protocol === "https:" ? 443 : 80))
    const proxySecure = proxy.protocol === "https:"
    const credentials = proxy.username
      ? "Basic " +
        Buffer.from(
          `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`,
        ).toString("base64")
      : undefined

    const connectHost = targetHost.replace(/^\[|\]$/g, "")
    const connectTarget = `${connectHost}:${targetPort}`
    const head =
      `CONNECT ${connectTarget} HTTP/1.1\r\n` +
      `Host: ${connectTarget}\r\n` +
      (credentials ? `Proxy-Authorization: ${credentials}\r\n` : "") +
      "\r\n"

    let upstream
    if (proxySecure) {
      upstream = tlsConnect({ host: proxyHost, port: proxyPort, servername: proxyHost })
    } else {
      upstream = tcpConnect(proxyPort, proxyHost)
    }

    upstream.on("error", reject)
    upstream.on(proxySecure ? "secureConnect" : "connect", () => upstream.write(head))

    let received = Buffer.alloc(0)
    upstream.on("data", (chunk) => {
      received = Buffer.concat([received, chunk])
      const end = received.indexOf("\r\n\r\n")
      if (end === -1) return
      upstream.removeAllListeners("data")
      const statusLine = received.slice(0, received.indexOf("\r\n")).toString("utf8")
      const code = Number(statusLine.split(" ")[1])
      if (code !== 200) {
        upstream.destroy()
        reject(new Error(`proxy CONNECT failed: ${statusLine}`))
        return
      }
      const leftover = received.slice(end + 4)
      if (leftover.length > 0) upstream.unshift(leftover)
      if (secureTarget) {
        const secured = tlsConnect({ socket: upstream, servername: connectHost })
        secured.on("error", reject)
        secured.once("secureConnect", () => resolve(secured))
      } else {
        resolve(upstream)
      }
    })
  })
}
