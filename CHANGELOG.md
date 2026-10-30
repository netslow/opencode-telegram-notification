# Changelog

## [2.0.0] - 2026-10-22

### Изменено
- **Миграция на OpenCode V2**: плагин переписан под новый API плагинов OpenCode 2.x.
  - Entry-point переведён на `export default { id: "telegram-notify", async setup(ctx) }`.
  - Пользовательские промпты теперь захватываются через `ctx.session.hook("prompt", ...)`.
  - События завершения перехватываются через `ctx.event.subscribe({ signal })` с `AbortController` для корректной очистки.
  - Формат события изменён: данные берутся из `event.data` (с fallback на `event.properties`).
- **Обработка событий**:
  - Завершение run: `session.execution.succeeded`, `session.execution.failed`, `session.execution.interrupted`.
  - Fallback: `session.idle` (дедуплицируется очередью).
  - Ожидание пользователя: `form.created` (встроенный инструмент `question`) и `permission.asked`.
- **Сбор данных о сессии**:
  - Используются `ctx.session.get({ sessionID })` и `ctx.session.context({ sessionID })`.
  - Поддержаны плоские V2-сообщения: `type: "user"` + `text`, `type: "assistant"` + `content[]` (с сохранением совместимости с V1-форматом).
- **Логирование**: убрано использование `client.app.log`. Логирование теперь идёт в `console` (перехватывается OpenCode) и в диагностический лог `~/.local/share/opencode/log/telegram-notify.log`.

### Добавлено
- Локальные JSDoc-типы без зависимостей `@opencode/*`.
- Поддержка `form.created` для уведомлений «OpenCode ждёт ответа».
- Поддержка `session.execution.interrupted`.
- Мгновенные уведомления с дедупликацией по `requestID` и `cooldown` 30 секунд на сессию.

### Удалено
- Зависимости `@opencode-ai/plugin` и `@opencode-ai/sdk` (V1).
- Использование хука `chat.message`, событий `session.error`, `question.*`, `permission.v2.asked` как основного механизма (оставлены как безопасный fallback).

### Обновлено
- **Тесты**: `tests/lifecycle.test.ts`, `tests/plugin.test.ts` переписаны под V2.
- **Документация**: `README.md` и `.opencode/skills/telegram-notify/SKILL.md` переведены на V2-термины.
- **Глобальная установка**: скопированы V2-версии плагина в `~/.config/opencode/plugins/`, удалён `@opencode-ai/plugin` из глобального `package.json`.

### Проверено
- `npm run typecheck` — пройдена.
- `npm test` — 5 файлов, 80 тестов, все пройдены.
- Smoke-тест в OpenCode 2.1.3: prompt-hook и события завершения работают корректно, дублей уведомлений нет.
