/**
 * LifecycleTracker — binds a notification to the *current* run.
 *
 *   prompt hook                  → capture the user prompt and queue a notification
 *   session.execution.succeeded  → consume the queue (exactly once) and send Telegram
 *   session.execution.failed     → remember the failure, then send the notification
 *   session.idle                 → fallback completion event (deduped)
 *   form.created                 → OpenCode paused and waits for the user to answer (send now)
 *   permission.asked             → OpenCode waits for the user to approve/reject a tool (send now)
 *
 * A notification is queued for every user prompt, so a Telegram message is
 * sent after every completed run (success or error). Every public method is
 * fire-and-forget: failures are logged, never thrown, so the plugin can never
 * break an opencode run.
 *
 * Plain JavaScript (JSDoc types) so the plugin loads under OpenCode Desktop,
 * whose Node runtime cannot import `.ts` files.
 */

/**
 * @typedef {object} LifecycleDeps
 * @property {import("./types.js").SessionDomain} session
 * @property {{ enabled: boolean, send: (text: string) => Promise<{ ok: boolean }> }} notifier
 * @property {(data: import("./types.js").RunCompletionData) => string} formatter
 * @property {(data: import("./formatter.js").AwaitingInputData) => string} [awaitingFormatter]
 * @property {string} project
 * @property {string} [directory]
 * @property {import("./types.js").Logger} log
 * @property {() => number} [now]
 * @property {number} [maxPending]
 */

/**
 * Legacy V1 `chat.message` input.
 *
 * @typedef {object} ChatMessageInput
 * @property {string} sessionID
 * @property {string} [agent]
 * @property {{ providerID: string, modelID: string }} [model]
 * @property {string} [messageID]
 * @property {string} [variant]
 */

/**
 * Legacy V1 `chat.message` output.
 *
 * @typedef {object} ChatMessageOutput
 * @property {{ id: string, role?: string }} message
 * @property {Array<{ type: string, text?: string, synthetic?: boolean, ignored?: boolean }>} parts
 */

/** Accepts either the raw event or a plugin hook wrapper `{ event }`. */
/** @typedef {{ event?: import("./types.js").BusEvent } | import("./types.js").BusEvent} EventInput */

/**
 * @typedef {import("./types.js").NotifyRequest & { agent?: string, title?: string }} Pending
 */

const DEFAULT_MAX_PENDING = 200
const AWAITING_COOLDOWN_MS = 30000

export class LifecycleTracker {
  /** @type {Map<string, Pending>} */
  pending = new Map()
  /** @type {Map<string, string>} */
  errors = new Map()
  /** @type {Map<string, { requestID: string, ts: number }>} */
  awaiting = new Map()

  /**
   * @param {LifecycleDeps} deps
   */
  constructor(deps) {
    this.deps = deps
  }

  /**
   * Handle the V2 `prompt` hook — capture the prompt and queue a notification.
   *
   * @param {import("./types.js").PromptEvent} event
   */
  onPrompt(event) {
    try {
      if (!event?.sessionID) return
      const text =
        typeof event.prompt?.text === "string" ? event.prompt.text.trim() : ""
      if (!text) return

      /** @type {Pending} */
      const pending = {
        sessionID: event.sessionID,
        prompt: text,
        requestedAt: (this.deps.now ?? Date.now)(),
      }
      this.enqueue(pending)
    } catch (error) {
      this.deps.log("error", "prompt handler failed", {
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Legacy V1 `chat.message` hook. Kept so the lifecycle can still be used by
   * an old plugin entry point; V2 uses `onPrompt`.
   *
   * @param {ChatMessageInput} input
   * @param {ChatMessageOutput} output
   */
  onChatMessage(input, output) {
    try {
      if (!input?.sessionID) return
      if (output?.message?.role && output.message.role !== "user") return

      const text = this.textFromParts(output?.parts ?? []).trim()
      if (!text) return

      /** @type {Pending} */
      const pending = {
        sessionID: input.sessionID,
        prompt: text,
        model: input.model
          ? `${input.model.providerID}/${input.model.modelID}`
          : undefined,
        agent: input.agent,
        requestedAt: (this.deps.now ?? Date.now)(),
      }
      this.enqueue(pending)
    } catch (error) {
      this.deps.log("error", "chat.message handler failed", {
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * @param {Pending} pending
   */
  enqueue(pending) {
    if (
      this.pending.size >= (this.deps.maxPending ?? DEFAULT_MAX_PENDING) &&
      !this.pending.has(pending.sessionID)
    ) {
      this.deps.log("warn", "pending queue full; dropping oldest", {
        sessionID: pending.sessionID,
      })
      const oldest = this.pending.keys().next().value
      if (oldest) this.pending.delete(oldest)
    }

    this.pending.set(pending.sessionID, pending)
    this.deps.log("info", "notification queued for run", {
      sessionID: pending.sessionID,
    })
  }

  /**
   * Handle the V2 event stream. Accepts both the raw event and the legacy
   * `{ event }` wrapper.
   *
   * @param {EventInput} input
   */
  async onEvent(input) {
    try {
      const raw =
        input && typeof input === "object" && "event" in input && input.event
          ? input.event
          : input
      const event = /** @type {import("./types.js").BusEvent} */ (raw)
      if (!event?.type) return

      const data = eventData(event)

      if (event.type === "session.execution.succeeded") {
        await this.handleCompletion(asString(data.sessionID))
        return
      }
      if (event.type === "session.execution.failed") {
        const sessionID = asString(data.sessionID)
        this.rememberError(sessionID, data.error)
        await this.handleCompletion(sessionID)
        return
      }
      if (event.type === "session.execution.interrupted") {
        const sessionID = asString(data.sessionID)
        this.rememberError(sessionID, {
          name: "Interrupted",
          message: asString(data.reason) ?? "unknown",
        })
        await this.handleCompletion(sessionID)
        return
      }
      if (event.type === "session.idle") {
        await this.handleCompletion(asString(data.sessionID))
        return
      }
      if (event.type === "session.deleted") {
        const sessionID =
          asString(data.sessionID) ??
          asString(/** @type {Record<string, unknown> | undefined} */ (data.info)?.id)
        if (sessionID) {
          this.pending.delete(sessionID)
          this.errors.delete(sessionID)
          this.awaiting.delete(sessionID)
        }
        return
      }
      if (event.type === "form.created") {
        this.handleFormCreated(
          /** @type {import("./types.js").FormInfo | undefined} */ (data.form),
        )
        return
      }
      if (event.type === "permission.asked") {
        this.handlePermissionAsked(data)
        return
      }

      // Legacy V1 event names. V2 does not emit them, but accepting them keeps
      // older callers harmless.
      if (event.type === "session.error") {
        this.rememberError(asString(data.sessionID), data.error)
        return
      }
      if (event.type === "question.v2.asked" || event.type === "question.asked") {
        this.handleLegacyQuestion(data)
        return
      }
      if (event.type === "permission.v2.asked") {
        this.handlePermissionAsked(data)
      }
    } catch (error) {
      this.deps.log("error", "event handler failed", {
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Consume the queued notification (if any) and send the Telegram message.
   *
   * @param {string | undefined} sessionID
   */
  async handleCompletion(sessionID) {
    if (!sessionID) return
    const queued = this.pending.get(sessionID)
    const cachedError = this.errors.get(sessionID)
    this.pending.delete(sessionID)
    this.errors.delete(sessionID)

    if (!queued) return

    if (!this.deps.notifier.enabled) {
      this.deps.log("warn", "notification requested but telegram is disabled", {
        sessionID,
      })
      return
    }

    const data = await this.collect(queued, cachedError)
    const text = this.deps.formatter(data)
    try {
      const result = await this.deps.notifier.send(text)
      if (!result.ok) {
        this.deps.log("warn", "telegram send failed; opencode run is unaffected", {
          sessionID,
          error: result,
        })
      } else {
        this.deps.log("info", "telegram notification sent", { sessionID })
      }
    } catch (error) {
      this.deps.log("error", "telegram notifier threw; run is unaffected", {
        sessionID,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Backwards-compatible alias for the V1 completion event name.
   *
   * @param {string} sessionID
   */
  async handleIdle(sessionID) {
    await this.handleCompletion(sessionID)
  }

  /**
   * Handle `form.created`: the run paused and OpenCode waits for the user to
   * answer. Sends the notification immediately.
   *
   * @param {import("./types.js").FormInfo | undefined} form
   */
  handleFormCreated(form) {
    if (!form || typeof form !== "object") return
    const sessionID = asString(form.sessionID)
    const requestID = asString(form.id)
    if (!sessionID || !requestID) return
    if (!this.shouldNotifyAwaiting(sessionID, requestID)) return

    const fields = Array.isArray(form.fields) ? form.fields : []
    const questions = fields
      .filter((field) => field && typeof field === "object" && field.hidden !== true)
      .map((field) => {
        if (typeof field.title === "string" && field.title.trim()) {
          return field.title.trim()
        }
        if (typeof field.description === "string" && field.description.trim()) {
          return field.description.trim()
        }
        if (typeof field.key === "string" && field.key.trim()) {
          return field.key.trim()
        }
        return ""
      })
      .filter(Boolean)
    if (
      questions.length === 0 &&
      typeof form.title === "string" &&
      form.title.trim()
    ) {
      questions.push(form.title.trim())
    }

    void this.sendAwaiting(
      {
        kind: "question",
        project: this.deps.project,
        sessionID,
        questions,
      },
      requestID,
    )
  }

  /**
   * Handle `permission.asked`: a tool needs the user to approve / reject.
   * Sends the notification immediately.
   *
   * @param {Record<string, unknown>} data
   */
  handlePermissionAsked(data) {
    const sessionID = asString(data.sessionID)
    const requestID = asString(data.id)
    if (!sessionID || !requestID) return
    if (!this.shouldNotifyAwaiting(sessionID, requestID)) return

    const resources = Array.isArray(data.resources)
      ? data.resources.filter((resource) => typeof resource === "string")
      : Array.isArray(data.patterns)
        ? data.patterns.filter((pattern) => typeof pattern === "string")
        : undefined

    void this.sendAwaiting(
      {
        kind: "permission",
        project: this.deps.project,
        sessionID,
        permission:
          asString(data.action) ??
          asString(data.permission),
        patterns: resources,
      },
      requestID,
    )
  }

  /**
   * Legacy `question.*` V1 event payload.
   *
   * @param {Record<string, unknown>} data
   */
  handleLegacyQuestion(data) {
    const sessionID = asString(data.sessionID)
    const requestID = asString(data.id)
    if (!sessionID || !requestID) return
    if (!this.shouldNotifyAwaiting(sessionID, requestID)) return

    const rawQuestions = Array.isArray(data.questions) ? data.questions : []
    const questions = rawQuestions
      .map((question) =>
        question &&
        typeof question === "object" &&
        typeof (/** @type {{ question?: unknown }} */ (question).question) === "string"
          ? /** @type {{ question: string }} */ (question).question
          : "",
      )
      .filter(Boolean)

    void this.sendAwaiting(
      {
        kind: "question",
        project: this.deps.project,
        sessionID,
        questions,
      },
      requestID,
    )
  }

  /**
   * Dedupe + cooldown gate for "user action required" notifications.
   * Skips a duplicate request id, and any request within the cooldown window.
   *
   * @param {string} sessionID
   * @param {string} requestID
   * @returns {boolean} True when a notification should be sent.
   */
  shouldNotifyAwaiting(sessionID, requestID) {
    const now = (this.deps.now ?? Date.now)()
    const previous = this.awaiting.get(sessionID)
    if (previous && previous.requestID === requestID) return false
    if (previous && now - previous.ts < AWAITING_COOLDOWN_MS) return false
    this.awaiting.set(sessionID, { requestID, ts: now })
    return true
  }

  /**
   * Send an "awaiting user input" notification. Fire-and-forget.
   *
   * @param {import("./formatter.js").AwaitingInputData} data
   * @param {string} requestID
   * @returns {Promise<void>}
   */
  async sendAwaiting(data, requestID) {
    try {
      if (!this.deps.notifier.enabled) {
        this.deps.log("warn", "user action required but telegram is disabled", {
          sessionID: data.sessionID,
          requestID,
          kind: data.kind,
        })
        return
      }
      const formatter =
        this.deps.awaitingFormatter ?? /** @type {never} */ (() => "")
      const text = formatter(data)
      const result = await this.deps.notifier.send(text)
      if (!result.ok) {
        this.deps.log("warn", "telegram send failed (user action required)", {
          sessionID: data.sessionID,
          requestID,
          kind: data.kind,
          error: result,
        })
      } else {
        this.deps.log("info", "telegram notification sent (user action required)", {
          sessionID: data.sessionID,
          requestID,
          kind: data.kind,
        })
      }
    } catch (error) {
      this.deps.log("error", "awaiting-input notifier threw; run is unaffected", {
        sessionID: data.sessionID,
        requestID,
        kind: data.kind,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * @param {string | undefined} sessionID
   * @param {unknown} error
   */
  rememberError(sessionID, error) {
    if (!sessionID) return
    const summary = summarizeError(error)
    if (summary) this.errors.set(sessionID, summary)
  }

  /**
   * Build the notification payload, fetching the final session data.
   *
   * @param {Pending} queued
   * @param {string | undefined} cachedError
   * @returns {Promise<import("./types.js").RunCompletionData>}
   */
  async collect(queued, cachedError) {
    const finishedAt = (this.deps.now ?? Date.now)()

    let sessionTitle = queued.title
    let directory = this.deps.directory
    let prompt = queued.prompt
    let model = queued.model
    let result
    let error = cachedError
    /** @type {import("./types.js").RunStatus} */
    let status = cachedError ? "error" : "success"

    const sessionInfo = await this.fetchSession(queued.sessionID)
    if (sessionInfo) {
      if (sessionInfo.title) sessionTitle = sessionInfo.title
      const sessionDirectory =
        sessionInfo.location?.directory ?? sessionInfo.directory
      if (sessionDirectory) directory = sessionDirectory
      if (!model && sessionInfo.model) {
        model = `${sessionInfo.model.providerID}/${sessionInfo.model.id}`
      }
    }

    const messages = await this.fetchMessages(queued.sessionID)
    if (messages.length > 0) {
      const userText = this.lastUserPrompt(messages)
      if (userText) prompt = userText

      const assistant = this.lastAssistant(messages)
      if (assistant) {
        const assistantText = this.assistantText(assistant)
        if (assistantText) result = assistantText
        const assistantError = summarizeError(assistant.error)
        if (assistantError) {
          error = assistantError
          status = "error"
        }
      }
    }

    if (error) status = "error"

    return {
      ...queued,
      model,
      status,
      project: this.deps.project,
      result,
      error,
      finishedAt,
      directory,
      sessionTitle,
    }
  }

  /**
   * @param {string} sessionID
   * @returns {Promise<import("./types.js").SessionInfo | undefined>}
   */
  async fetchSession(sessionID) {
    try {
      const result = await this.deps.session.get({ sessionID })
      const info = /** @type {import("./types.js").SessionInfo | undefined} */ (
        unwrapData(result)
      )
      if (info && typeof info === "object") return info
    } catch (error) {
      this.deps.log("debug", "failed to fetch session info", {
        sessionID,
        message: error instanceof Error ? error.message : String(error),
      })
    }
    return undefined
  }

  /**
   * @param {string} sessionID
   * @returns {Promise<import("./types.js").SessionMessage[]>}
   */
  async fetchMessages(sessionID) {
    try {
      const result = await this.deps.session.context({ sessionID })
      const data = unwrapData(result)
      if (Array.isArray(data)) {
        return /** @type {import("./types.js").SessionMessage[]} */ (data)
      }
    } catch (error) {
      this.deps.log("debug", "failed to fetch session messages", {
        sessionID,
        message: error instanceof Error ? error.message : String(error),
      })
    }
    return []
  }

  /**
   * @param {import("./types.js").SessionMessage[]} messages
   * @returns {string | undefined}
   */
  lastUserPrompt(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      const isUser =
        message?.type === "user" || message?.info?.role === "user"
      if (!isUser) continue

      const text =
        typeof message.text === "string" && message.text.trim()
          ? message.text.trim()
          : this.textFromParts(message.content ?? message.parts ?? []).trim()
      if (text) return text
    }
    return undefined
  }

  /**
   * @param {import("./types.js").SessionMessage[]} messages
   * @returns {import("./types.js").SessionMessage | undefined}
   */
  lastAssistant(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (
        message?.type === "assistant" ||
        message?.info?.role === "assistant"
      ) {
        return message
      }
    }
    return undefined
  }

  /**
   * @param {import("./types.js").SessionMessage} message
   * @returns {string | undefined}
   */
  assistantText(message) {
    const parts = message.content ?? message.parts ?? []
    const texts = parts
      .filter(
        (part) =>
          part.type === "text" && !part.synthetic && !part.ignored && part.text,
      )
      .map((part) => part.text?.trim())
      .filter(Boolean)
    if (texts.length > 0) return texts[texts.length - 1]
    if (message.summary?.body) return message.summary.body
    return undefined
  }

  /**
   * @param {Array<{ type: string, text?: string }>} parts
   * @returns {string}
   */
  textFromParts(parts) {
    return parts
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text)
      .join("\n")
  }
}

/**
 * V2 events carry the payload in `data`; accept legacy `properties` too.
 *
 * @param {import("./types.js").BusEvent} event
 * @returns {Record<string, unknown>}
 */
function eventData(event) {
  if (event.data && typeof event.data === "object") return event.data
  if (event.properties && typeof event.properties === "object") {
    return event.properties
  }
  return {}
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function asString(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/** Normalize a fetch response that may be `{ data }` or the value itself. */
/**
 * @param {unknown} result
 * @returns {unknown}
 */
function unwrapData(result) {
  if (result && typeof result === "object" && "data" in result) {
    return /** @type {{ data: unknown }} */ (result).data
  }
  return result
}

/**
 * Convert an opencode error object (or anything else) into a short human
 * readable summary. Never throws.
 *
 * @param {unknown} error
 * @returns {string | undefined}
 */
export function summarizeError(error) {
  if (!error) return undefined
  try {
    if (typeof error === "string") return error
    if (typeof error !== "object") return undefined
    const err = /** @type {{ name?: string, type?: string, message?: string, data?: { message?: string } | string }} */ (
      error
    )
    const name = err.name ?? err.type
    const message =
      typeof err.data === "object" && err.data !== null
        ? err.data.message
        : err.message
    if (name && message) return `${name}: ${message}`
    if (message) return message
    if (name) return name
    return undefined
  } catch {
    return undefined
  }
}
