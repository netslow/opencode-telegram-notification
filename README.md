# telegram-notify — OpenCode V2 plugin

An OpenCode plugin (**OpenCode V2** plugin format) that sends a **Telegram notification after every user prompt/run completes** (whether it succeeds or fails) — automatically, without any special instruction in the prompt.

```text
Implement JWT authentication.
```

Any completed run triggers a notification.

---

## Purpose

- Detects when a specific OpenCode run has finished.
- Sends a Telegram notification after every completed run.
- Sends one message containing the result (success or failure).
- Sends exactly one notification per completed run (strict one-shot).
- When a run is **waiting for user input** (the model asks a question or a tool needs permission), it sends a separate immediate notification.
- Localizes the notification templates (English, Russian and Spanish; defaults to English).
- Telegram errors never break OpenCode.

## Installation

The plugin is a set of plain JavaScript files with **no runtime dependencies**. Install it once for a single project or globally for all projects.

### Before you start

- **OpenCode V2** — the plugin uses the V2 plugin API and does not work with V1.
- **Node.js runtime** — provided by OpenCode; the plugin uses only Node.js built-in modules.
- **A Telegram bot token and chat ID** — create them in step 1.

### Step 1 — Create a Telegram bot

1. In Telegram, open [@BotFather](https://t.me/BotFather) and send `/newbot`.
2. Pick a name and a username. BotFather replies with a token like `123456:ABC-...` — copy it.
3. Open your new bot and send it any message. A bot cannot start a chat with you, so this step is required before it can send notifications.
4. Get the chat ID:
   - **Private chat:** message [@userinfobot](https://t.me/userinfobot); it replies with your numeric `id`.
   - **Group:** add the bot to the group, send a message in the group, open `https://api.telegram.org/bot<TOKEN>/getUpdates`, and copy `chat.id` (usually negative, e.g. `-1001234567890`).
   - **Channel:** add the bot as an administrator, publish a post, then use the same `getUpdates` URL.

### Step 2 — Copy the plugin

Choose **one** installation type.

#### Global install

Notifications in every project. Copy the same files to the global OpenCode directory:

- Linux/macOS: `~/.config/opencode/plugins/`
- Windows: `%USERPROFILE%\.config\opencode\plugins\`

Then make sure `~/.config/opencode/package.json` contains `"type": "module"` (on Windows: `%USERPROFILE%\.config\opencode\package.json`), creating it if needed.

#### Project install

Notifications only for one project. Copy from this repository into your project:

```text
.opencode/plugins/telegram-notify.js
.opencode/plugins/telegram-notify/     (the whole folder)
```

The result must look like this:

```text
your-project/
└── .opencode/
    ├── package.json
    └── plugins/
        ├── telegram-notify.js
        └── telegram-notify/
            ├── config.js
            ├── formatter.js
            ├── i18n.js
            ├── lifecycle.js
            ├── notifier.js
            ├── types.js
            └── locales/
                ├── en.js
                ├── ru.js
                └── es.js
```

`your-project/.opencode/package.json` must contain `"type": "module"`. If the file does not exist, create it with exactly:

```json
{
  "type": "module"
}
```

Do not add npm dependencies: the plugin runs on Node.js built-in modules only.

> **Important for both options:** remove any old V1 copy of the plugin. V2 copies with the same `id` load only once, but a V1 copy without an `id` can load a second time and send duplicate notifications.

### Step 3 — Add the bot credentials

Create a `.env` file in the same scope as the plugin:

- **Project install:** `<your-project>/.env`
- **Global install:** `~/.config/opencode/.env` (Windows: `%USERPROFILE%\.config\opencode\.env`)

Add the two required variables:

```text
TELEGRAM_BOT_TOKEN=123456:ABC-...
TELEGRAM_CHAT_ID=42
```

That is enough to start. Optional variables (timeout, retries, language, proxy) are described in [Environment variables](#environment-variables).

Keep these rules in mind:

- Already-set environment variables win over `.env`; the project `.env` wins over the global one.
- The token is never written to logs.
- The plugin is enabled automatically when the token and chat ID are present; set `TELEGRAM_ENABLED=false` to mute it.

### Step 4 — Restart OpenCode

Plugins and `.env` files are read at startup, so fully quit and reopen OpenCode. `TELEGRAM_LANGUAGE` is the only setting that is re-read for every notification and does not need a restart.

### Step 5 — Verify the installation

From the root of this repository, with the same credentials available in its `.env` or the global `.env` (install dev dependencies once with `npm install`):

```sh
npm run telegram:diagnose   # prints the config and checks api.telegram.org; sends nothing
npm run telegram:test-send  # sends a real test message
```

Exit code `0` means success. Then run any prompt in OpenCode and wait for the run to finish — a Telegram message should arrive. For the remaining checks, including the “waiting for an answer” and permission notifications, see [Verification](#verification).

### Updating and uninstalling

- **Update:** replace `telegram-notify.js` and the `telegram-notify/` folder with the new versions, then restart OpenCode. Your `.env` stays as is.
- **Uninstall:** delete `telegram-notify.js` and the `telegram-notify/` folder from the plugin directory, restart OpenCode, and optionally remove the `TELEGRAM_*` variables from `.env`.

## Architecture

```text
                    OpenCode V2
                        |
               ctx.session.hook("prompt")
                        |
                        v
               LifecycleTracker   (each user prompt is queued)
                        |
                   OpenCode run
                        |
         session.execution.succeeded / .failed / .interrupted
         (+ session.idle as fallback)
                        |
                        v
               formatter → TelegramNotifier
                        |
                        v
                  Telegram Bot API
```

### How it works with the real OpenCode V2 API (not invented)

The plugin uses the V2 format: default export `{ id: "telegram-notify", async setup(ctx) }`. Inside `setup`, it registers the prompt hook and event subscription, and returns a cleanup function that unsubscribes.

| Task | OpenCode V2 mechanism |
| --- | --- |
| “User submitted a prompt” | `await ctx.session.hook("prompt", handler)` (payload contains `sessionID` and `prompt.text`) |
| “Run completed successfully” | event `session.execution.succeeded` (`event.data.sessionID`) |
| “Run failed with an error” | event `session.execution.failed` (`event.data.sessionID`, `event.data.error`) |
| “Run was interrupted” | event `session.execution.interrupted` (`event.data.sessionID`, `event.data.reason`) |
| Fallback “run completed” | event `session.idle` (`event.data.sessionID`), deduplicated by the queue |
| “Run is waiting for the user’s answer” | event `form.created` (`event.data.form`) |
| “A tool needs permission” | event `permission.asked` (`event.data`) |

Events arrive through `ctx.event.subscribe({ signal })` — an asynchronous stream that the plugin reads in the background and cancels with `AbortController` on shutdown. Message data is collected via `ctx.session.get({ sessionID })` (title, model, directory) and `ctx.session.context({ sessionID })` (messages; in V2 they are flat: `type: "user"` + `text`, `type: "assistant"` + `content[]`). OpenCode auto-discovers the plugin from `.opencode/plugins/*.js` (no configuration registration needed).

Legacy V1 names (`chat.message`, `session.error`, `question.*`, `permission.v2.asked`, `event.properties`) are supported as a safe fallback, but V2 does not emit them.

### Plugin modules

| File | Responsibility |
| --- | --- |
| `.opencode/plugins/telegram-notify.js` | V2 plugin entry point (`{ id, setup }`), prompt-hook registration, event subscription, logger with token redaction |
| `telegram-notify/lifecycle.js` | state machine: prompt → queue → run complete → send; waiting for response (form/permission); data assembly |
| `.opencode/plugins/telegram-notify/notifier.js` | isolated Telegram Bot API client (timeout, retry, errors); transport built on Node.js built-in modules (`node:http/https/net/tls`), including HTTP(S) proxy via CONNECT tunnel |
| `telegram-notify/formatter.js` | pure message formatting |
| `telegram-notify/i18n.js` | locale resolution and message-catalog selection (fallback: English) |
| `telegram-notify/locales/en.js` / `ru.js` / `es.js` | localized Telegram message templates |
| `telegram-notify/config.js` | loading env / `.env`, token redaction |
| `telegram-notify/types.js` | local JSDoc types (V2-oriented, no dependency on `@opencode/*`) |

State: each user prompt is placed into a queue for its session (`Map<sessionID, Pending>`). The `session.execution.succeeded` / `.failed` / `.interrupted` events (as well as the `session.idle` fallback) take the entry exactly once and send the notification — so each completed run produces exactly one message, and it does not “bleed over” into the next prompt.

The “waiting for response” notification follows a **separate path** (not through the completion queue): the `form.created` / `permission.asked` event is sent immediately and does not interfere with the final run-completion notification. To avoid spamming, deduplication by request ID and a **30-second cooldown** per session apply (at most one such notification per 30 seconds).

## Environment variables

Copy `.env.example` to `.env` (next to your project) or add the variables to your environment. **The global file `~/.config/opencode/.env` is also supported** (on Windows: `%USERPROFILE%\.config\opencode\.env`) — the plugin reads it automatically:

```text
TELEGRAM_BOT_TOKEN=123456:ABC-...
TELEGRAM_CHAT_ID=42
```

Optional:

```text
# default: true (auto-enabled when token and chat ID are set)
TELEGRAM_ENABLED=true
# timeout for a single Bot API request, in seconds (default: 10)
TELEGRAM_TIMEOUT_SECONDS=10
# number of retry attempts after the first one (default: 2)
TELEGRAM_RETRIES=2
# optional notification language (supported: en, ru, es; default: en)
TELEGRAM_LANGUAGE=ru
```

The plugin log is always written to `~/.local/share/opencode/log/telegram-notify.log` (on Windows: `%USERPROFILE%\.local\share\opencode\log\telegram-notify.log`); the path cannot be overridden.

Value precedence: environment variables → `<project>/.env` → `~/.config/opencode/.env`. Already-set environment variables are not overwritten by `.env`. The `.env` file is searched only in the project directory and the global configuration directory; the user’s home directory is **not** scanned for `.env`.

The token is never logged: before writing to the log, it is replaced with `***`.

## Verification

Run these commands from the root of this repository (after `npm install`), with the credentials available in its `.env` or the global `.env`:

```sh
npm run telegram:diagnose   # what the plugin sees + Telegram connectivity (getMe); does not send messages
npm run telegram:test-send  # sends a test message using the same code as the plugin
```

- `telegram:diagnose` prints: which `.env` files were found, whether token/chat ID are set, proxy values (masked), and checks `getMe` using the same transport code as the plugin (proxy is considered). Exit code `0` means everything is fine.
- `telegram:test-send` sends a test message (success → exit code `0`).

Live check in OpenCode V2:

1. Restart OpenCode in the project (plugins and Telegram credentials are read at startup; `TELEGRAM_LANGUAGE` is re-read for every notification).
2. Run any prompt, for example: “Analyze the project structure.”
3. After completion, a message should arrive in Telegram.
4. To test “waiting for response”: run the prompt “Ask me whether to continue” (the model calls the built-in `question` tool, and OpenCode emits `form.created`) — a ⚠️ notification should arrive immediately. To test permissions, give a tool a command that requires confirmation (`ask` rule) — a 🔐 notification should arrive (`permission.asked`).

V2 no longer has `client.app.log`: the plugin writes to `console` (OpenCode captures this output) and always appends a diagnostic log to `~/.local/share/opencode/log/telegram-notify.log` (on Windows: `%USERPROFILE%\.local\share\opencode\log\telegram-notify.log`). Log lines look like this:

```json
{"ts":"...","level":"info","message":"Telegram notification enabled","extra":{...}}
```

## Proxy

The plugin supports HTTP(S) proxy via standard environment variables (or the same keys in `.env`):

```text
HTTPS_PROXY=http://proxy.example.com:8080
HTTP_PROXY=http://proxy.example.com:8080
NO_PROXY=localhost,127.0.0.1,10.0.0.0/8
```

- Requests to `https://api.telegram.org` go through `HTTPS_PROXY` (the presence of `HTTP_PROXY` is also considered for HTTP requests).
- `NO_PROXY` excludes hosts/subnets from proxying.
- Credentials in the URL are supported: `http://user:pass@proxy.example.com:8080`.
- Lowercase keys are also recognized (`http_proxy`, `https_proxy`, `no_proxy`).
- Only HTTP(S) proxies are supported (no SOCKS); the proxy connection uses a CONNECT tunnel implemented on Node.js built-in modules — no third-party npm packages required.
- If no proxy is configured, requests go directly (behavior unchanged).

## Behavior

A notification is sent **automatically after every completed run** (success or failure) — no need to add anything to the prompt. Exactly one message per run.

If, during a run, OpenCode is **waiting for user action** — the model asks a question via the built-in `question` tool (`form.created` event) or a tool needs permission (`permission.asked` event) — the plugin immediately sends a separate “OpenCode is waiting for you” notification. Such a notification is deduplicated by request ID and arrives at most once every 30 seconds per session; you can use it to return to OpenCode and answer without keeping the window open.

If you do not want notifications for a while, set `TELEGRAM_ENABLED=false` in `.env` / the environment.

## Localization (i18n)

The notification templates are stored separately for each supported locale:

- `.opencode/plugins/telegram-notify/locales/en.js` — English
- `.opencode/plugins/telegram-notify/locales/ru.js` — Russian
- `.opencode/plugins/telegram-notify/locales/es.js` — Spanish

The locale is resolved in the following order:

1. `TELEGRAM_LANGUAGE` (process environment, project `.env`, or global `.env`) — **highest priority**;
2. the OpenCode language setting, if the plugin context exposes one (`language` / `locale` / `lang`);
3. `LC_ALL`;
4. `LANG`;
5. the current system locale (`Intl.DateTimeFormat().resolvedOptions().locale`).

`TELEGRAM_LANGUAGE` is read again for every notification, so changing it in `.env` takes effect on the next message — no need to restart OpenCode for a language change.

Only the primary language subtag is used (`ru-RU` → `ru`, `en-US` → `en`, `es-ES` → `es`). If the resolved locale is not supported, the plugin falls back to **English**.

### Telegram message examples (English)

Success:

```text
✅ OpenCode completed successfully

Request:
Analyze why the integration tests are failing and fix the issue.

Result:
Integration tests have been fixed.

Project:
my-project

Duration: 3 min 12 s
Working directory:
C:\dev\my-project
Model:
anthropic/claude
Run ID: <session-id>
```

Failure:

```text
❌ OpenCode finished with an error

Request:
Fix the integration tests.

Error:
APIError: 401 unauthorized

Project:
my-project
Run ID: <session-id>
```

OpenCode is waiting for your answer (question from the model):

```text
⚠️ OpenCode is waiting for your answer

Question:
Continue working?

Project:
my-project

Run ID: <session-id>

→ Open OpenCode to answer
```

OpenCode is waiting for permission (tool):

```text
🔐 OpenCode is requesting permission

Action:
bash

Targets:
npm run build

Project:
my-project

Run ID: <session-id>

→ Open OpenCode to answer
```

### Telegram message examples (Russian)

Success:

```text
✅ OpenCode завершил выполнение

Запрос:
Проанализируй, почему падают integration tests, и исправь проблему.

Результат:
Integration tests исправлены.

Проект:
my-project

Время: 3 мин 12 сек
Рабочая директория:
C:\dev\my-project
Модель:
anthropic/claude
Run ID: <session-id>
```

Failure:

```text
❌ OpenCode завершил работу с ошибкой

Запрос:
Исправь integration tests.

Ошибка:
APIError: 401 unauthorized

Проект:
my-project
Run ID: <session-id>
```

OpenCode is waiting for your answer (question from the model):

```text
⚠️ OpenCode ждёт твой ответ

Вопрос:
Продолжить работу?

Проект:
my-project

Run ID: <session-id>

→ Открой OpenCode, чтобы ответить
```

OpenCode is waiting for permission (tool):

```text
🔐 OpenCode запрашивает разрешение

Действие:
bash

Цели:
npm run build

Проект:
my-project

Run ID: <session-id>

→ Открой OpenCode, чтобы ответить
```

### Telegram message examples (Spanish)

Success:

```text
✅ OpenCode completó la ejecución correctamente

Solicitud:
Analiza por qué fallan las pruebas de integración y corrige el problema.

Resultado:
Las pruebas de integración están corregidas.

Proyecto:
my-project

Duración: 3 min 12 s
Directorio de trabajo:
C:\dev\my-project
Modelo:
anthropic/claude
Run ID: <session-id>
```

Failure:

```text
❌ OpenCode terminó con un error

Solicitud:
Corrige las pruebas de integración.

Error:
APIError: 401 unauthorized

Proyecto:
my-project
Run ID: <session-id>
```

OpenCode is waiting for your answer (question from the model):

```text
⚠️ OpenCode espera tu respuesta

Pregunta:
¿Continuar con el trabajo?

Proyecto:
my-project

Run ID: <session-id>

→ Abre OpenCode para responder
```

OpenCode is waiting for permission (tool):

```text
🔐 OpenCode solicita permiso

Acción:
bash

Objetivos:
npm run build

Proyecto:
my-project

Run ID: <session-id>

→ Abre OpenCode para responder
```

## Troubleshooting

- **No notification arrives** — start with `npm run telegram:diagnose` (configuration + Telegram connectivity) and `npm run telegram:test-send` (send test). Make sure `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set in the project `.env` **or** `~/.config/opencode/.env`, that the bot can message you, and restart OpenCode. Live plugin events are visible in its diagnostic log (default: `~/.local/share/opencode/log/telegram-notify.log`, on Windows: `%USERPROFILE%\.local\share\opencode\log\telegram-notify.log`).
- **No notification even though config is in `~/.config/opencode/.env`** — ensure OpenCode is running in a project where the plugin is located (`.opencode/plugins/*.js`), or that the plugin is installed globally. The plugin reads the global `.env` in both cases.
- **Plugin is not picked up** — the file must be in `.opencode/plugins/*.js` (top level only), not nested deeper. Configuration/environment variables are read at startup — a restart is required. In OpenCode Desktop (Electron, Node.js core), plugins are loaded via raw `import()`, so files must be plain JavaScript (`.js`), not TypeScript (`.ts`). Set `"type": "module"` in `.opencode/package.json` (or `~/.config/opencode/package.json` for the global copy).
- **Plugin loads, but no events** — verify that you are using OpenCode V2: V1 hooks (`event`, `chat.message`) and V1 events (`session.error`, `question.*`) are no longer invoked. The plugin log at startup should contain `Telegram notification enabled` (or `disabled`), and after a prompt — `notification queued for run`.
- **Notification is not sent, but network is behind a proxy** — check `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY` (see the “Proxy” section). If the proxy requires authentication, credentials must be in the URL. In the plugin diagnostic log (or `telegram:diagnose` output), look for `telegram network error` (masked).
- **Message arrived twice** — check whether an old V1 copy of the plugin remains nearby (without an `id`, for example global V1 + project V2): V2 copies with the same `id` load once, but a copy without an `id` may load a second time. Other causes: two OpenCode instances are running on the same project, or a separate “waiting for response” notification arrived together with the final one (these are different messages, by design).
- **Message language is not what you expected** — set `TELEGRAM_LANGUAGE=ru` (or `en`, `es`) in `.env` / the environment. It has priority over the OpenCode language setting and the OS locale, and is re-read for every notification. If `TELEGRAM_LANGUAGE` is omitted, the plugin uses the OpenCode language setting (when exposed), then `LC_ALL` / `LANG` / the system locale; unsupported locales fall back to English.

## Implementation limitations

- **The plugin must be written in plain JavaScript (`.js`)** with JSDoc types, not TypeScript (`.ts`): OpenCode Desktop (Electron, Node.js core) loads file-based plugins via raw `await import()`, and Node.js cannot import `.ts` files without transpilation. As a result, `.ts` plugins silently fail to load. Set `"type": "module"` in `.opencode/package.json`, otherwise `.js` files will be treated as CommonJS.
- The plugin is written for **OpenCode V2** (`{ id, setup(ctx) }`, `ctx.session.hook("prompt")`, `ctx.event.subscribe()`, `ctx.session.get/context`). It does not work with OpenCode V1.
- A notification is sent after every completed run (`session.execution.*`; fallback — `session.idle`), regardless of prompt text.
- The notification is tied to the completion of the current run; the plugin does not track “business tasks”, issues, or Task Service.
- “Waiting for response” notifications (`form.created`/`permission.asked`) arrive at most once every 30 seconds per session (cooldown) and are deduplicated by request ID — this is anti-spam protection, not a lossless subscription to all events.
- The message includes the final assistant text (truncated to 800 characters), the prompt (up to 500), and the error (up to 500). Sensitive data (tokens, `.env`, passwords, keys) is not sent automatically.
- Telegram is only a notification channel: if sending fails, the OpenCode run continues as usual (fire-and-forget, up to 2 retries with backoff).
- Proxy: only HTTP(S), no SOCKS (see the “Proxy” section).

## Development and testing

```sh
npm install          # install dependencies
npm test             # run unit + integration tests (vitest, single pass)
npm run test:watch   # run tests in watch mode (on file changes)
npm run typecheck    # type checking (tsc --noEmit)
npm run telegram:diagnose   # what the plugin sees + Telegram connectivity (getMe)
npm run telegram:test-send  # send a test message (actually sends to the chat)
```

The tests do not use the real Telegram API — the HTTP layer is mocked via `fetch`/dependency injection. Coverage includes: successful completion (`session.execution.succeeded`), run failure (`.failed`), interruption (`.interrupted`), `session.idle` fallback, one notification per run (one-shot), two sequential prompts, `form.created`, `permission.asked`, missing token/chat ID, `.env` reading (project/global/proxy), locale resolution and RU/EN message templates, Telegram HTTP/network errors, and “a Telegram error does not break OpenCode”.
