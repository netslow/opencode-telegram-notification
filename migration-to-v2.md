Коротко: в OpenCode 2.1.3 **полностью поменялся API плагинов**. Старый код под V1 просто не работал.

## В чём была проблема

В V1 плагин использовал механики, которых в V2 больше нет или они изменились:

- **Хук промпта** — в V1 ловили через `chat.message`, в V2 нужен `ctx.session.hook("prompt", ...)`
- **События завершения ранга** — в V1 были `session.idle` / `session.error`, в V2 используются `session.execution.succeeded`, `session.execution.failed`, `session.execution.interrupted` (+ `session.idle` как fallback)
- **Ожидание пользователя** — в V1 были `question.*`/`permission.*`, в V2 это `form.created` (для встроенного `question`) и `permission.asked`
- **Формат событий** — в V1 данные лежали в `event.properties`, в V2 — в `event.data`
- **Работа с сессией/сообщениями** — другой API, плоский формат сообщений в V2
- **Логирование** — в V1 использовался `client.app.log`, в V2 его нет
- **Форма плагина** — в V1 был другой entrypoint, в V2 плагин должен быть `export default { id, setup(ctx) }`

## Что я сделал

1. **Переписал entry-point** — `.opencode/plugins/telegram-notify.js` перевёл на V2-формат. Регистрирует prompt-hook через `ctx.session.hook("prompt")`, подписывается на события через `ctx.event.subscribe({ signal })` с `AbortController` для корректной очистки.
2. **Адаптировал `lifecycle.js`** — переделал обработку под новые события, научил парсить плоские V2-сообщения, сохранил ключевую логику: **ровно одно уведомление на каждый завершённый run**, очередь по `sessionID`, мгновенные уведомления при `form.created`/`permission.asked` с дедупликацией и cooldown'ом 30 секунд.
3. **Обновил типы** — `types.js` переписан под V2, убрал зависимость от `@opencode/*`. Теперь все типы только локальные JSDoc.
4. **Переписал тесты** — `tests/lifecycle.test.ts` и `tests/plugin.test.ts` адаптировал под V2-события и новый контекст.
5. **Обновил документацию** — `README.md` и `.opencode/skills/telegram-notify/SKILL.md` перевёл на V2-термины (`session.execution.*`, `form.created`, `permission.asked`, `ctx.session.hook`, `ctx.event.subscribe`).
6. **Синхронизировал глобальную установку** — скопировал все правки в `~/.config/opencode/plugins/`, убрал из глобального `package.json` ненужный `@opencode-ai/plugin`.
7. **Проверил** — `npm run typecheck` и `npm test` (80/80) прошли, в `opencode-cli 2.1.3` убедился, что prompt-hook и события завершения ранга корректно отрабатывают.

Суть простая: не чинил старый код, а **полностью мигрировал плагин под V2-API**, максимально сохранив прежнее поведение.