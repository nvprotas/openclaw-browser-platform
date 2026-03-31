# MVP0 ToDo

Рабочий чеклист для сборки `MVP0` по дорожной карте проекта.

## Этап 1. Bootstrap

- [ ] Выбрать и зафиксировать package manager.
- [ ] Создать `package.json`.
- [ ] Добавить `tsconfig.json`.
- [ ] Подключить `eslint`.
- [ ] Подключить `prettier`.
- [ ] Подключить `vitest`.
- [ ] Подключить `playwright`.
- [ ] Создать базовый `playwright.config.ts`.
- [ ] Добавить команды `lint`, `test`, `build`.
- [ ] Настроить базовый CI: `install + lint + test`.

Критерий завершения:
проект устанавливается с нуля и проходит `lint` и `test`.

## Этап 2. Каркас репозитория

- [ ] Создать `src/core`.
- [ ] Создать `src/playwright`.
- [ ] Создать `src/helpers`.
- [ ] Создать `src/packs`.
- [ ] Создать `src/traces`.
- [ ] Создать `src/runtime`.
- [ ] Создать `site-packs`.
- [ ] Создать `traces`.
- [ ] Создать `examples`.
- [ ] Создать `tests`.
- [ ] Добавить базовые типы в `src/core/types`.
- [ ] Добавить базовые ошибки в `src/core/errors`.

Критерий завершения:
структура репозитория соответствует целевой архитектуре и не требует переезда файлов после старта разработки.

## Этап 3. Базовый Playwright runtime

- [ ] Реализовать `src/playwright/browser-session.ts`.
- [ ] Реализовать `src/playwright/controller.ts`.
- [ ] Поддержать команды `navigate`, `click`, `fill`, `type`, `extract`, `screenshot`.
- [ ] Реализовать `src/playwright/waits.ts`.
- [ ] Реализовать `src/playwright/snapshots.ts`.
- [ ] Добавить structured logging на каждый step.
- [ ] Сделать один smoke test на простой flow.

Критерий завершения:
можно программно выполнить простой flow без site pack.

## Этап 4. Shared helpers v1

- [ ] Реализовать `src/helpers/navigation.ts`.
- [ ] Реализовать `src/helpers/popups.ts`.
- [ ] Реализовать `src/helpers/search.ts`.
- [ ] Реализовать `src/helpers/cart.ts`.
- [ ] Реализовать `src/helpers/validation.ts`.
- [ ] Реализовать `src/helpers/retries.ts`.
- [ ] Добавить trace hooks в helpers.
- [ ] Покрыть helpers базовыми unit-тестами.

Критерий завершения:
flow собирается из helpers, а не из разрозненных вызовов Playwright.

## Этап 5. Site pack spec

- [ ] Описать формат `manifest.json`.
- [ ] Описать формат `instructions.md`.
- [ ] Описать формат `hints.json`.
- [ ] Описать `support levels`.
- [ ] Реализовать `src/packs/loader.ts`.
- [ ] Реализовать доменный выбор pack.
- [ ] Подключить instructions injection в runtime.
- [ ] Подключить hints injection в runtime.

Критерий завершения:
runtime умеет запускаться в `pack-assisted mode`.

## Этап 6. Traces v1

- [ ] Реализовать `src/traces/trace-schema.ts`.
- [ ] Реализовать `src/traces/trace-store.ts`.
- [ ] Определить layout артефактов в `traces/raw`.
- [ ] Сохранять step logs.
- [ ] Сохранять screenshots.
- [ ] Сохранять DOM/HTML snapshots.
- [ ] Реализовать `src/traces/artifact-index.ts`.
- [ ] Реализовать базовый `src/traces/replay.ts`.

Критерий завершения:
после падения видно точный шаг, состояние страницы и все артефакты запуска.

## Этап 7. Example site pack

- [ ] Создать `site-packs/example-shop/manifest.json`.
- [ ] Создать `site-packs/example-shop/instructions.md`.
- [ ] Создать `site-packs/example-shop/hints.json`.
- [ ] Подготовить минимальный skeleton для pack.
- [ ] Добавить `examples/demo-pack-run.ts`.
- [ ] Проверить загрузку pack по домену.
- [ ] Прогнать demo flow end-to-end.

Критерий завершения:
есть один эталонный pack, на котором можно проверить систему целиком.

## Этап 8. Минимальный handoff marker

- [ ] Добавить в runtime состояние `needs_human`.
- [ ] Фиксировать причину остановки в trace.
- [ ] Фиксировать последний успешный step в trace.
- [ ] Сохранять screenshot в точке handoff.
- [ ] Сохранять snapshot в точке handoff.

Критерий завершения:
система явно отмечает момент, где нужна помощь человека, и не теряет контекст остановки.

## Этап 9. Приёмка MVP0

- [ ] Прогнать базовый flow на простом сайте.
- [ ] Проверить, что trace показывает точку поломки.
- [ ] Вручную поправить pack.
- [ ] Повторно прогнать flow после правки pack.
- [ ] Обновить `README.md` командами запуска.
- [ ] Зафиксировать краткий документ с текущим статусом `MVP0`.

Критерий завершения:
выполнены критерии готовности `MVP0`: flow проходит в `pack-assisted mode`, сбои локализуются по trace, pack можно чинить вручную.

## Рекомендуемый порядок коммитов

- [ ] Commit 1: Bootstrap
- [ ] Commit 2: Runtime
- [ ] Commit 3: Helpers
- [ ] Commit 4: Pack spec
- [ ] Commit 5: Traces
- [ ] Commit 6: Example pack
- [ ] Commit 7: Handoff marker
- [ ] Commit 8: MVP0 acceptance
