# telegram-notify — OpenCode V2 skill + plugin

OpenCode-плагин (формат плагинов **OpenCode V2**), который отправляет **Telegram-уведомление после завершения каждого** пользовательского prompt/run (успех или ошибка) — автоматически, без специальной просьбы в промпте.

```text
Реализуй авторизацию через JWT.
```

Любой завершённый run вызывает уведомление.

---

## Назначение

- Определяет момент завершения конкретного run OpenCode.
- Отправляет уведомление в Telegram после каждого завершённого run.
- Отправляет одно сообщение с результатом (успех или ошибка).
- Ровно одно уведомление на каждый завершённый run (strict one-shot).
- Когда run **ждёт пользователя** (модель задала вопрос или инструменту нужно разрешение) — отправляет отдельное немедленное уведомление.
- Поддерживает локализацию шаблонов сообщений (русский, английский и испанский; по умолчанию английский).
- Ошибки Telegram никогда не ломают OpenCode.

## Архитектура

```text
                   OpenCode V2
                       |
              ctx.session.hook("prompt")
                       |
                       v
              LifecycleTracker   (каждый user prompt ставится в очередь)
                       |
                  OpenCode run
                       |
        session.execution.succeeded / .failed / .interrupted
        (+ session.idle как fallback)
                       |
                       v
              formatter → TelegramNotifier
                       |
                       v
                 Telegram Bot API
```

### Как это работает с реальными API OpenCode V2 (не выдумано)

Плагин использует V2-формат: default export `{ id: "telegram-notify", async setup(ctx) }`. В `setup` он регистрирует prompt-hook и подписку на события, а возвращает функцию очистки, которая отменяет подписку.

| Задача | Механизм OpenCode V2 |
| --- | --- |
| Момент «пользователь отправил prompt» | `await ctx.session.hook("prompt", handler)` (payload содержит `sessionID` и `prompt.text`) |
| Момент «run завершён успешно» | event `session.execution.succeeded` (`event.data.sessionID`) |
| Момент «run упал с ошибкой» | event `session.execution.failed` (`event.data.sessionID`, `event.data.error`) |
| Момент «run прерван» | event `session.execution.interrupted` (`event.data.sessionID`, `event.data.reason`) |
| Fallback «run завершён» | event `session.idle` (`event.data.sessionID`), дедуплицируется очередью |
| Момент «run ждёт ответа пользователя» | event `form.created` (`event.data.form`) |
| Момент «инструменту нужно разрешение» | event `permission.asked` (`event.data`) |

События приходят через `ctx.event.subscribe({ signal })` — асинхронный поток, который плагин читает в фоне и отменяет через `AbortController` при выгрузке. Данные для сообщения собираются через `ctx.session.get({ sessionID })` (заголовок, модель, директория) и `ctx.session.context({ sessionID })` (сообщения; в V2 они плоские: `type: "user"` + `text`, `type: "assistant"` + `content[]`). Плагин автообнаруживается OpenCode из `.opencode/plugins/*.js` (без регистрации в конфиге).

Legacy-имена V1 (`chat.message`, `session.error`, `question.*`, `permission.v2.asked`, `event.properties`) поддерживаются как безопасный fallback, но V2 их не эмитит.

### Модули плагина

| Файл | Ответственность |
| --- | --- |
| `.opencode/plugins/telegram-notify.js` | entry point V2-плагина (`{ id, setup }`), регистрация prompt-hook и подписки на события, логгер с redaction токена |
| `telegram-notify/lifecycle.js` | state machine: prompt → очередь → run complete → send; ожидание ответа (form/permission); сборка данных |
| `.opencode/plugins/telegram-notify/notifier.js` | изолированный Telegram Bot API клиент (timeout, retry, errors); транспорт на встроенных модулях Node (`node:http/https/net/tls`), включая HTTP(S)-прокси через CONNECT-tunnel |
| `telegram-notify/formatter.js` | чистое форматирование сообщения |
| `telegram-notify/i18n.js` | определение локали и выбор каталога сообщений (fallback: английский) |
| `telegram-notify/locales/en.js` / `ru.js` / `es.js` | локализованные шаблоны Telegram-сообщений |
| `telegram-notify/config.js` | загрузка env / `.env`, redaction токена |
| `telegram-notify/types.js` | локальные JSDoc-типы (V2-oriented, без зависимости от `@opencode/*`) |
| `.opencode/skills/telegram-notify/SKILL.md` | skill-инструкция для агента OpenCode |

Состояние: каждый user prompt помещается в очередь для своей сессии (`Map<sessionID, Pending>`). События `session.execution.succeeded` / `.failed` / `.interrupted` (а также fallback `session.idle`) забирают запись ровно один раз и отправляют уведомление — поэтому на каждый завершённый run приходит одно сообщение, и оно не «перетекает» на следующий промпт.

Уведомление «ждёт ответа» идёт **отдельным путём** (не через очередь завершения): событие `form.created` / `permission.asked` отправляется немедленно и не мешает финальному уведомлению о завершении run. Чтобы не спамить, действует дедупликация по id запроса и **cooldown 30 секунд** на сессию (максимум одно такое уведомление в 30 с).

## Установка

1. Скопируйте содержимое репозитория в ваш проект (или добавьте файлы в существующий):

   - `.opencode/plugins/telegram-notify.js` + папку `.opencode/plugins/telegram-notify/`
   - `.opencode/skills/telegram-notify/SKILL.md`

2. Установите зависимости (нужны только для разработки/тестов — сам плагин работает на встроенных модулях Node и не требует ни одного npm-пакета в рантайме):

   ```sh
   npm install
   ```

3. Перезапустите OpenCode (плагины и env читаются при старте).

### Глобальная установка (для всех проектов)

Чтобы уведомления приходили в любом проекте, скопируйте плагин в глобальный каталог конфига:

- `~/.config/opencode/plugins/telegram-notify.js` + папку `~/.config/opencode/plugins/telegram-notify/`
- `~/.config/opencode/skills/telegram-notify/SKILL.md` (необязательно)
- токен/chat id — в `~/.config/opencode/.env`

(на Windows глобальный каталог — `%USERPROFILE%\.config\opencode`, например `C:\Users\you\.config\opencode`)

Плагин не имеет runtime-зависимостей, поэтому работает и там. Убедитесь, что `~/.config/opencode/package.json` содержит `"type": "module"` (иначе Node загрузит плагин по эвристике ESM с предупреждением). Зависимость `@opencode-ai/plugin` не нужна — и для V2 её лучше не держать.

Не устанавливайте рядом старую V1-копию плагина: V2-копии с одинаковым `id` загружаются один раз, а V1-копия без `id` может загрузиться второй и дать дубли уведомлений.

4. Проверьте, что плагин активен (см. раздел «Проверка работоспособности»).

## Настройка Telegram bot

1. В Telegram напишите [@BotFather](https://t.me/BotFather) → `/newbot` → получите токен вида `123456:ABC-...`.
2. Напишите своему боту любое сообщение (чтобы он мог писать вам первым).
3. Узнайте ваш `chat id`: напишите [@userinfobot](https://t.me/userinfobot) — он пришлёт `id`.

## Environment variables

Скопируйте `.env.example` в `.env` (рядом с проектом) или добавьте переменные в окружение. **Поддерживается глобальный файл `~/.config/opencode/.env`** (на Windows — `%USERPROFILE%\.config\opencode\.env`) — плагин читает его автоматически:

```text
TELEGRAM_BOT_TOKEN=123456:ABC-...
TELEGRAM_CHAT_ID=42
```

Опционально:

```text
# по умолчанию true (активируется автоматически, если заданы токен и chat id)
TELEGRAM_ENABLED=true
# таймаут одного запроса к Bot API, секунды (по умолчанию 10)
TELEGRAM_TIMEOUT_SECONDS=10
# число повторных попыток поверх первой (по умолчанию 2)
TELEGRAM_RETRIES=2
# необязательный язык уведомлений (поддерживаются: en, ru, es; по умолчанию en)
TELEGRAM_LANGUAGE=ru
```

Лог плагина всегда пишется в `~/.local/share/opencode/log/telegram-notify.log` (на Windows — `%USERPROFILE%\.local\share\opencode\log\telegram-notify.log`), путь не переопределяется.

Приоритет значений: переменные окружения → `<project>/.env` → `~/.config/opencode/.env`. Уже заданные переменные окружения не перезаписываются `.env`. Файл `.env` ищется только в каталоге проекта и в глобальном каталоге конфигурации; домашний каталог пользователя для `.env` **не** сканируется.

Токен нигде не логируется: перед записью в лог он заменяется на `***`.

## Проверка работоспособности

```sh
npm run telegram:diagnose   # что видит плагин + связь с Telegram (getMe), сообщения не шлёт
npm run telegram:test-send  # отправка тестового сообщения тем же кодом, что плагин
```

- `telegram:diagnose` выводит: какие `.env` файлы найдены, заполнены ли токен/chat id, значения прокси (маскируются), и проверяет `getMe` тем же кодом транспорта, что плагин (прокси учитывается). Код выхода `0` — всё в порядке.
- `telegram:test-send` отправляет тестовое сообщение (успех → код `0`).

Живая проверка в OpenCode V2:

1. Перезапустите OpenCode в проекте (плагин и env читаются при старте).
2. Выполните любой промпт, например: «Проанализируй структуру проекта.»
3. После завершения должно прийти сообщение в Telegram.
4. Чтобы проверить «ждёт ответа»: выполните промпт «Спроси меня, продолжать ли работу» (модель вызовет встроенный инструмент `question`, OpenCode эмитит `form.created`) — сразу должно прийти уведомление ⚠️. Для проверки разрешений дайте инструменту команду, требующую подтверждения (правило `ask`) — придёт уведомление 🔐 (`permission.asked`).

У V2 больше нет `client.app.log`: плагин пишет в `console` (OpenCode захватывает этот вывод) и всегда дописывает диагностический лог в `~/.local/share/opencode/log/telegram-notify.log` (на Windows — `%USERPROFILE%\.local\share\opencode\log\telegram-notify.log`). Строки лога выглядят так:

```json
{"ts":"...","level":"info","message":"Telegram notification enabled","extra":{...}}
```

## Прокси

Плагин поддерживает HTTP(S)-прокси стандартными переменными окружения (или теми же ключами в `.env`):

```text
HTTPS_PROXY=http://proxy.example.com:8080
HTTP_PROXY=http://proxy.example.com:8080
NO_PROXY=localhost,127.0.0.1,10.0.0.0/8
```

- Запросы к `https://api.telegram.org` пойдут через `HTTPS_PROXY` (наличие `HTTP_PROXY` тоже учитывается для http-запросов).
- `NO_PROXY` исключает хосты/подсети из прокси.
- Поддерживаются credentials в URL: `http://user:pass@proxy.example.com:8080`.
- Учитываются и нижний регистр ключей (`http_proxy`, `https_proxy`, `no_proxy`).
- Поддерживаются только HTTP(S)-прокси (без SOCKS); прокси подключается через CONNECT-tunnel, реализованный на встроенных модулях Node — сторонние npm-пакеты не нужны.
- Если прокси не задан — запросы идут напрямую (без изменения поведения).

## Поведение

Уведомление отправляется **автоматически после каждого завершённого run** (успех или ошибка) — добавлять что-либо в промпт не нужно. Ровно одно сообщение на каждый run.

Если в ходе run OpenCode **ждёт действия пользователя** — модель задаёт вопрос через встроенный инструмент `question` (событие `form.created`) или инструменту нужно разрешение (событие `permission.asked`) — плагин сразу отправляет отдельное уведомление «OpenCode ждёт тебя». Такое уведомление дедуплицируется по id запроса и приходит не чаще одного раза в 30 секунд на сессию; по нему можно вернуться в OpenCode и ответить, не держа окно открытым.

Если уведомления не нужны на время — задайте `TELEGRAM_ENABLED=false` в `.env` / окружении.

## Локализация (i18n)

Шаблоны уведомлений хранятся отдельно для каждой поддерживаемой локали:

- `.opencode/plugins/telegram-notify/locales/en.js` — английский
- `.opencode/plugins/telegram-notify/locales/ru.js` — русский
- `.opencode/plugins/telegram-notify/locales/es.js` — испанский

Локаль выбирается в следующем порядке:

1. `TELEGRAM_LANGUAGE` (переменная окружения, проектный `.env` или глобальный `.env`) — **наивысший приоритет**;
2. язык из настроек OpenCode, если контекст плагина его предоставляет (`language` / `locale` / `lang`);
3. `LC_ALL`;
4. `LANG`;
5. текущая системная локаль (`Intl.DateTimeFormat().resolvedOptions().locale`).

`TELEGRAM_LANGUAGE` перечитывается для каждого уведомления, поэтому изменение в `.env` применяется к следующему сообщению — перезапускать OpenCode ради смены языка не нужно.

Учитывается только основной языковой тег (`ru-RU` → `ru`, `en-US` → `en`, `es-ES` → `es`). Если выбранная локаль не поддерживается, плагин использует **английский** язык.

### Примеры Telegram-сообщений (английский)

Успех:

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

Ошибка:

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

OpenCode ждёт ответа (вопрос от модели):

```text
⚠️ OpenCode is waiting for your answer

Question:
Continue working?

Project:
my-project

Run ID: <session-id>

→ Open OpenCode to answer
```

OpenCode ждёт разрешения (инструмент):

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

### Примеры Telegram-сообщений (русский)

Успех:

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

Ошибка:

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

OpenCode ждёт ответа (вопрос от модели):

```text
⚠️ OpenCode ждёт твой ответ

Вопрос:
Продолжить работу?

Проект:
my-project

Run ID: <session-id>

→ Открой OpenCode, чтобы ответить
```

OpenCode ждёт разрешения (инструмент):

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

### Примеры Telegram-сообщений (испанский)

Успех:

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

Ошибка:

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

OpenCode ждёт ответа (вопрос модели):

```text
⚠️ OpenCode espera tu respuesta

Pregunta:
¿Continuar con el trabajo?

Proyecto:
my-project

Run ID: <session-id>

→ Abre OpenCode para responder
```

OpenCode ждёт разрешения (инструмент):

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

- **Уведомление не приходит** — начните с `npm run telegram:diagnose` (конфигурация + связь с Telegram) и `npm run telegram:test-send` (отправка). Убедитесь, что `TELEGRAM_BOT_TOKEN` и `TELEGRAM_CHAT_ID` заданы в `.env` проекта **или** `~/.config/opencode/.env`, бот имеет право писать вам, и перезапустите OpenCode. Живые события плагина смотрите в его диагностическом логе (по умолчанию `~/.local/share/opencode/log/telegram-notify.log`, на Windows — `%USERPROFILE%\.local\share\opencode\log\telegram-notify.log`).
- **Уведомление не приходит, хотя конфиг в `~/.config/opencode/.env`** — убедитесь, что OpenCode запущен в проекте, где лежит плагин (`.opencode/plugins/*.js`), либо что плагин установлен глобально. Плагин читает глобальный `.env` в обоих случаях.
- **Плагин не подхватывается** — файл должен лежать в `.opencode/plugins/*.js` (только первый уровень), а не глубже. Плагин и Telegram-креденшелы читаются при старте — после их изменения нужен перезапуск; `TELEGRAM_LANGUAGE` перечитывается для каждого уведомления. В OpenCode Desktop (Electron, ядро на Node.js) плагины загружаются сырым `import()`, поэтому файлы должны быть на чистом JavaScript (`.js`), а не TypeScript (`.ts`). Установите `"type": "module"` в `.opencode/package.json` (или `~/.config/opencode/package.json` для глобальной копии).
- **Плагин загружается, но событий нет** — проверьте, что используется OpenCode V2: V1-хуки (`event`, `chat.message`) и V1-события (`session.error`, `question.*`) больше не вызываются. В логе плагина при старте должна быть строка `Telegram notification enabled` (или `disabled`), а после промпта — `notification queued for run`.
- **Уведомление не уходит, но сеть за прокси** — проверьте `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY` (см. раздел «Прокси»). Если прокси с авторизацией — credentials должны быть в URL. В диагностическом логе плагина (или в выводе `telegram:diagnose`) ищите `telegram network error` (замаскировано).
- **Сообщение пришло дважды** — проверьте, не осталась ли рядом старая V1-копия плагина (без `id`, например глобальная V1 и проектная V2): V2-копии с одинаковым `id` загружаются один раз, а копия без `id` может загрузиться второй. Другие причины: запущено две копии OpenCode на одном проекте, либо пришло отдельное уведомление «ждёт ответа» вместе с финальным (это разные сообщения, так и задумано).
- **Язык сообщения не тот, который ожидался** — задайте `TELEGRAM_LANGUAGE=ru` (или `en`, `es`) в `.env` / окружении. Он имеет приоритет над языком из настроек OpenCode и системной локалью и перечитывается для каждого уведомления. Если `TELEGRAM_LANGUAGE` не задан, плагин использует язык из настроек OpenCode (если он доступен), затем `LC_ALL` / `LANG` / системную локаль; неподдерживаемые локали откатываются на английский.

## Ограничения реализации

- **Плагин обязан быть на чистом JavaScript (`.js`)** с JSDoc-типами, а не TypeScript (`.ts`): OpenCode Desktop (Electron, ядро на Node.js) загружает файловые плагины через сырой `await import()`, и Node.js не умеет импортировать `.ts` без транспиляции. Из-за этого `.ts`-плагины молча не загружаются. Установите `"type": "module"` в `.opencode/package.json`, иначе `.js` будет трактоваться как CommonJS.
- Плагин написан под **OpenCode V2** (`{ id, setup(ctx) }`, `ctx.session.hook("prompt")`, `ctx.event.subscribe()`, `ctx.session.get/context`). С OpenCode V1 он не работает.
- Уведомление отправляется после каждого завершённого run (`session.execution.*`; fallback — `session.idle`), независимо от текста промпта.
- Уведомление привязано к завершению текущего run; плагин не отслеживает «бизнес-задачи», issues или Task Service.
- Уведомления «ждёт ответа» (`form.created`/`permission.asked`) приходят не чаще одного раза в 30 секунд на сессию (cooldown) и с дедупликацией по id запроса — это защита от спама, а не lossless-подписка на все события.
- В сообщение попадает финальный текст ассистента (усекается до 800 символов), prompt (до 500), ошибка (до 500). Чувствительные данные (токены, `.env`, пароли, ключи) автоматически не отправляются.
- Telegram является только каналом уведомления: при сбое отправки run OpenCode продолжается как обычно (fire-and-forget, до 2 retry с backoff).
- Прокси: только HTTP(S), без SOCKS (см. раздел «Прокси»).

## Разработка и тесты

```sh
npm install          # установка зависимостей
npm test             # запуск unit + интеграционных тестов (vitest, один прогон)
npm run test:watch   # тесты в watch-режиме (при изменении файлов)
npm run typecheck    # проверка типов (tsc --noEmit)
npm run telegram:diagnose   # что видит плагин + связь с Telegram (getMe)
npm run telegram:test-send  # отправка тестового сообщения (реально шлёт в чат)
```

Тесты не используют реальный Telegram API — HTTP слой мокается через `fetch`/инъекцию зависимостей. Покрытие включает: успешное завершение (`session.execution.succeeded`), ошибка run (`.failed`), прерывание (`.interrupted`), fallback `session.idle`, одно уведомление на run (one-shot), два последовательных prompt, `form.created`, `permission.asked`, отсутствие токена/chat id, чтение `.env` (проект/глобальный/прокси), локализацию и RU/EN шаблоны, HTTP/network ошибки Telegram, «ошибка Telegram не ломает OpenCode».
