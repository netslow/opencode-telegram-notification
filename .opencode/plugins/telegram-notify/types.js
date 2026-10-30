/**
 * Shared types for the telegram-notify plugin.
 *
 * These types are intentionally framework-agnostic (no imports from
 * `@opencode/*`) so that every module can be unit-tested in isolation and the
 * plugin keeps zero runtime dependencies.
 *
 * Written as JSDoc typedefs because OpenCode Desktop loads file plugins via
 * Node's raw `import()`, and Node cannot import TypeScript files.
 */

/**
 * @typedef {"success" | "error"} RunStatus
 */

/**
 * @typedef {object} TelegramConfig
 * @property {boolean} enabled True when Telegram is enabled AND both token and chat id are present.
 * @property {string} [botToken]
 * @property {string} [chatId]
 * @property {number} timeoutMs
 * @property {number} retries Number of retries on top of the initial attempt.
 * @property {number} retryDelayMs
 * @property {object} [proxy] HTTP(S) proxy settings, read from HTTP_PROXY / HTTPS_PROXY / NO_PROXY (and lowercase variants) in the environment / `.env` files. When a field is undefined the underlying agent falls back to the process environment.
 * @property {string} [proxy.httpProxy]
 * @property {string} [proxy.httpsProxy]
 * @property {string} [proxy.noProxy]
 * @property {string} [logFile] File path for diagnostic logs. Always `~/.local/share/opencode/log/telegram-notify.log` on Linux/macOS (`%USERPROFILE%\.local\share\opencode\log\telegram-notify.log` on Windows). Never contains the bot token.
 * @property {string} [locale] Resolved locale used for Telegram message templates (supported: `en`, `ru`; default `en`).
 */

/**
 * @typedef {object} NotifyRequest
 * @property {string} sessionID
 * @property {string} prompt The user prompt that asked for the notification.
 * @property {string} [model]
 * @property {number} requestedAt Epoch ms when the request was captured (used to compute duration).
 */

/**
 * @typedef {NotifyRequest & {
 *   status: RunStatus,
 *   project: string,
 *   result?: string,
 *   error?: string,
 *   finishedAt: number,
 *   directory?: string,
 *   sessionTitle?: string,
 * }} RunCompletionData
 */

/**
 * @typedef {object} SendResult
 * @property {boolean} ok
 * @property {boolean} [skipped]
 * @property {string} [reason]
 * @property {string} [error] HTTP status / Telegram description / network error message.
 */

/**
 * Structured error emitted by OpenCode V2 (`session.execution.failed` and
 * assistant messages). V1 used `{ name, data: { message } }`; both shapes are
 * accepted.
 *
 * @typedef {object} SessionStructuredError
 * @property {string} [type]
 * @property {string} [name] Legacy V1 error name.
 * @property {string} [message]
 * @property {number} [status]
 * @property {{ body: string }} [response]
 * @property {{ message?: string } | string} [data] Legacy V1 error payload.
 * @property {number} [retryAfterMs]
 */

/**
 * Content part of a V2 assistant message. V1 used `parts`; both are accepted.
 *
 * @typedef {object} SessionMessagePart
 * @property {string} type
 * @property {string} [text]
 * @property {boolean} [synthetic] Legacy V1 marker.
 * @property {boolean} [ignored] Legacy V1 marker.
 */

/**
 * A message returned by `session.context()`.
 *
 * V2 messages are flat: user messages have `type: "user"` and `text`; assistant
 * messages have `type: "assistant"` and a `content` array. The optional V1
 * fields (`info`, `parts`) keep the lifecycle compatible with old payloads.
 *
 * @typedef {object} SessionMessage
 * @property {string} id
 * @property {string} type
 * @property {string} [text] V2 user prompt text.
 * @property {SessionMessagePart[]} [content] V2 assistant content.
 * @property {SessionMessagePart[]} [parts] Legacy V1 content.
 * @property {{ id: string, providerID: string, variant?: string }} [model]
 * @property {{ created: number, completed?: number }} [time]
 * @property {SessionStructuredError} [error]
 * @property {{ role?: "user" | "assistant" }} [info] Legacy V1 message info.
 * @property {{ title?: string, body?: string }} [summary] Legacy V1 summary.
 */

/**
 * Session data returned by `session.get()`.
 *
 * @typedef {object} SessionInfo
 * @property {string} id
 * @property {string} [parentID]
 * @property {string} [title]
 * @property {{ directory: string }} [location] V2 location.
 * @property {string} [directory] Legacy V1 directory.
 * @property {{ id: string, providerID: string, variant?: string }} [model]
 * @property {{ created: number, updated: number }} [time]
 */

/**
 * The `prompt` hook event from `ctx.session.hook("prompt", ...)`.
 *
 * @typedef {object} PromptEvent
 * @property {string} sessionID
 * @property {string} [messageID]
 * @property {{ text?: string, files?: unknown[], agents?: unknown[], skills?: unknown[] }} prompt
 * @property {Record<string, unknown>} [metadata]
 * @property {"steer" | "queue"} [delivery]
 */

/**
 * A public OpenCode V2 event (`ctx.event.subscribe()`).
 *
 * V2 puts the payload in `data`; `properties` is accepted as a legacy V1
 * fallback.
 *
 * @typedef {object} BusEvent
 * @property {string} type
 * @property {Record<string, unknown>} [data]
 * @property {Record<string, unknown>} [properties] Legacy V1 payload.
 * @property {string} [id]
 * @property {number} [created]
 */

/**
 * One field of a V2 form (`form.created`).
 *
 * @typedef {object} FormField
 * @property {string} [key]
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [type]
 * @property {boolean} [hidden]
 */

/**
 * A V2 form. The built-in `question` tool is surfaced as a form.
 *
 * @typedef {object} FormInfo
 * @property {string} id
 * @property {string} sessionID
 * @property {string} title
 * @property {FormField[]} fields
 */

/**
 * Minimal session API used by the lifecycle tracker.
 *
 * @typedef {object} SessionDomain
 * @property {(input: { sessionID: string }) => Promise<SessionInfo>} get
 * @property {(input: { sessionID: string }) => Promise<SessionMessage[]>} context
 * @property {(name: "prompt", handler: (event: PromptEvent) => void | Promise<void>) => Promise<{ dispose: () => Promise<void> } | void>} [hook]
 */

/**
 * Minimal event API used by the plugin entry point.
 *
 * @typedef {object} EventDomain
 * @property {(options?: { signal?: AbortSignal }) => AsyncIterable<BusEvent>} subscribe
 */

/**
 * `ctx.location` from the V2 plugin context.
 *
 * @typedef {object} LocationInfo
 * @property {string} directory
 * @property {{ id?: string, directory?: string, canonical?: string }} [project]
 */

/**
 * Minimal V2 plugin context used by the entry point. Kept local so the plugin
 * has no runtime dependency on `@opencode/plugin`.
 *
 * @typedef {object} PluginContext
 * @property {LocationInfo} location
 * @property {SessionDomain} session
 * @property {EventDomain} event
 * @property {Record<string, unknown>} [options]
 */

/**
 * @typedef {(level: "debug" | "info" | "warn" | "error", message: string, extra?: Record<string, unknown>) => void} Logger
 */

export {}
