---
name: telegram-notify
description: >-
  The telegram-notify plugin sends a Telegram notification after every opencode
  V2 prompt/run finishes (success, error, or interruption). No trigger keyword
  is required — the notification is automatic for every run. It also notifies
  immediately when opencode pauses and waits for the user: a form such as the
  built-in question tool (form.created) or a permission request
  (permission.asked).
---

# Telegram Notification After Run Completion

The `telegram-notify` plugin sends a one-shot Telegram message after opencode
finishes processing **every user prompt/run** — automatically, whether the
prompt asks for it or not. When opencode **waits for the user** — a form
(including the built-in `question` tool) or a tool permission request — it
sends an immediate notification too.

The plugin targets **opencode V2** and is written as plain JavaScript with
JSDoc types. Its shape is the V2 default export `{ id, setup(ctx) }`.

## What the plugin does

- Captures every user prompt (`ctx.session.hook("prompt", ...)`) and queues a
  notification.
- On `session.execution.succeeded` sends the notification with status, prompt,
  result, project, duration, model, run id.
- On `session.execution.failed` sends the notification with the error details.
- On `session.execution.interrupted` sends the notification with the
  interruption reason.
- On `session.idle` (fallback completion event) sends the same notification if
  no execution event consumed the queue.
- Consumes the queue exactly once per run — the next prompt never re-sends it.
- On `form.created` sends "OpenCode waits for your answer" immediately; on
  `permission.asked` sends "OpenCode requests permission". Deduped by request
  id, at most one such message per 30 s per session. These go through a
  separate path and do not consume the run-completion queue.

Events are read from `ctx.event.subscribe({ signal })`, with the payload in
`event.data` (the legacy `event.properties` shape is accepted as a fallback).
Session details come from `ctx.session.get({ sessionID })` and
`ctx.session.context({ sessionID })`.

## What you (the agent) must do

1. **Do nothing extra.** The plugin sends the notification automatically after
   every run. Keep working normally.
2. **Never send Telegram messages yourself** and do not fake or simulate a
   notification. The plugin owns the Telegram integration.
3. If the notification did not arrive, do not retry by inventing messages —
   point the user at the troubleshooting section of the project README:
   `npm run telegram:diagnose` (config + connectivity) and
   `npm run telegram:test-send` (test message) in the project root, then restart
   opencode in the project. Config comes from the process environment,
   `<project>/.env`, or `~/.config/opencode/.env`. Behind a proxy,
   `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` are honored automatically. The
   plugin writes a diagnostic log to `~/.local/share/opencode/log/telegram-notify.log`
   (`%USERPROFILE%\.local\share\opencode\log\telegram-notify.log` on Windows) —
   this path is fixed. To see live plugin events (startup, prompt queued, send
   result), tail that file; V2 plugins also log to the console, but there is no
   `client.app.log`.
4. Do not keep an old V1 copy next to the V2 plugin: V2 copies with the same
   `id` load once, but a V1 copy without an `id` can load as a second plugin and
   produce duplicate notifications.

## Requirements

- opencode **V2** (the V1 hooks/events are no longer used).
- The plugin files load through Node's raw `import()`, so they must stay `.js`
  (no `.ts` transpilation at runtime).
- `"type": "module"` must be set in the `package.json` next to the plugin
  (`.opencode/package.json` or `~/.config/opencode/package.json`).
- No npm runtime dependencies, including no `@opencode-ai/plugin`.
