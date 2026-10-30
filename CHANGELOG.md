# Changelog

## [2.0.0] - 2026-10-22

### Changed
- **Migration to OpenCode V2**: the plugin has been rewritten for the new OpenCode 2.x plugin API.
  - The entry point now uses `export default { id: "telegram-notify", async setup(ctx) }`.
  - User prompts are now captured via `ctx.session.hook("prompt", ...)`.
  - Completion events are intercepted via `ctx.event.subscribe({ signal })` with an `AbortController` for proper cleanup.
  - The event format has changed: data is read from `event.data` (with a fallback to `event.properties`).
- **Event handling**:
  - Run completion: `session.execution.succeeded`, `session.execution.failed`, `session.execution.interrupted`.
  - Fallback: `session.idle` (deduplicated by the queue).
  - Waiting for the user: `form.created` (the built-in `question` tool) and `permission.asked`.
- **Session data collection**:
  - Uses `ctx.session.get({ sessionID })` and `ctx.session.context({ sessionID })`.
  - Flat V2 messages are supported: `type: "user"` + `text`, `type: "assistant"` + `content[]` (while remaining compatible with the V1 format).
- **Logging**: removed the use of `client.app.log`. Logging now goes to `console` (captured by OpenCode) and to the diagnostic log at `~/.local/share/opencode/log/telegram-notify.log`.

### Added
- Local JSDoc types without `@opencode/*` dependencies.
- Support for `form.created` for "OpenCode is waiting for an answer" notifications.
- Support for `session.execution.interrupted`.
- Instant notifications with deduplication by `requestID` and a 30-second `cooldown` per session.

### Removed
- The `@opencode-ai/plugin` and `@opencode-ai/sdk` dependencies (V1).
- Use of the `chat.message` hook and the `session.error`, `question.*`, `permission.v2.asked` events as the primary mechanism (kept as a safe fallback).

### Updated
- **Tests**: `tests/lifecycle.test.ts` and `tests/plugin.test.ts` have been rewritten for V2.
- **Documentation**: `README.md` and `.opencode/skills/telegram-notify/SKILL.md` have been updated to V2 terminology.
- **Global installation**: the V2 versions of the plugin were copied to `~/.config/opencode/plugins/`, and `@opencode-ai/plugin` was removed from the global `package.json`.

### Verified
- `npm run typecheck` — passed.
- `npm test` — 5 files, 80 tests, all passed.
- Smoke test in OpenCode 2.1.3: the prompt hook and completion events work correctly, with no duplicate notifications.
