# Repository Guidelines

## Project Structure & Module Organization
Проект написан на TypeScript и разделен на несколько зон ответственности:
- `src/cli` — CLI-команды (`daemon`, `session`) и обработка аргументов.
- `src/daemon` — сервер, клиент и реестр сессий.
- `src/playwright` — управление браузерной сессией и snapshot-механика.
- `src/helpers` — прикладные шаги для сценариев (поиск, корзина, платежный контекст).
- `src/packs` и `site-packs/` — загрузка и данные site-pack (сейчас пилот: LitRes).
- `tests/unit` и `tests/integration` — модульные и интеграционные тесты.
- `docs/` и корневые `*.md` — документация по установке, архитектуре и roadmap.

## Build, Test, and Development Commands
- `npm ci` — установка зависимостей в воспроизводимом режиме.
- `npm run build` — компиляция TypeScript в `dist/`.
- `npm run dev` — запуск CLI из исходников через `tsx`.
- `npm run lint` — проверка ESLint.
- `npm run format` / `npm run format:check` — форматирование и проверка Prettier.
- `npm test` — запуск всех тестов Vitest.
- `npm run playwright:test` — интеграционные сценарии Playwright.
- `./install.sh` — рекомендуемый bootstrap для локальной установки.

## Coding Style & Naming Conventions
Используйте ESM (`"type": "module"`), строгую типизацию TypeScript и форматирование через Prettier (дефолтные отступы, без ручного форматирования).  
Именование: файлы и модули — `kebab-case` (`payment-context.ts`), функции/переменные — `camelCase`, типы/классы — `PascalCase`.  
Неиспользуемые аргументы помечайте префиксом `_` (настроено в ESLint).

## Testing Guidelines
Тесты называются `*.test.ts` и лежат в `tests/**`. Для новой логики добавляйте минимум один unit-тест; для изменений CLI/daemon-поведения добавляйте integration-тест.  
Проверка перед PR: `npm run lint && npm test`. Для UI/браузерных регрессий дополнительно запускайте `npm run playwright:test`.

## Commit & Pull Request Guidelines
Стиль коммитов в истории: короткий imperative subject на английском (`Add ...`, `Fix ...`, `Finalize ...`). Первая строка до ~72 символов, без “WIP” в финальных коммитах.  
PR должен содержать:
- цель изменений и краткий scope;
- ссылку на issue/задачу (если есть);
- шаги проверки (какие команды запускались);
- для изменений пользовательского потока — артефакты (логи, JSON trace, скриншоты при необходимости).

## Language & Documentation Rules
Для этого репозитория документация, комментарии в коде и проектный `AGENTS.md` пишутся на русском языке.

## Ограничение Ожидания Команд
Для запуска команд через инструменты устанавливайте `yield_time_ms` не больше `7000` мс (7 секунд).
