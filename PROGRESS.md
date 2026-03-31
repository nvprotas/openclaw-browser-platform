# PROGRESS.md

Текущий прогресс по `openclaw-browser-platform`.

Последнее обновление: **2026-03-31 12:48 UTC**

## Короткий статус

- Commit 5 завершён и зафиксирован в git как `5b79465`
- добавлена схема текущей архитектуры в `ARCHITECTURE_CURRENT.md`
- LitRes уже тестируется на живом сайте
- поиск `1984` через новый runtime уже работает
- логин через `litres-sberid-login` и `browser-platform` пока **не склеены**

## Правило ведения файла

Этот файл нужно обновлять **после каждого заметного шага разработки**:
- после нового коммита
- после ручного теста на LitRes
- после фикса/обнаружения важного бага
- после push

Не ждать отдельного напоминания.

---

## Статус по коммитам MVP0_LITRES

### Commit 1 — Bootstrap + repo skeleton
- **Статус:** `done`
- **Git:** `1d96607`
- **Что сделано:**
  - npm project bootstrap
  - TypeScript/Vitest/ESLint/Prettier/Playwright setup
  - базовый CLI entrypoint
  - skeleton директорий

### Commit 2 — CLI + daemon skeleton
- **Статус:** `done`
- **Git:** `ba379f4`
- **Что сделано:**
  - daemon process / localhost server
  - session registry
  - JSON protocol
  - `daemon ensure/status`
  - `session open/context/close`

### Commit 3 — Playwright runtime v1
- **Статус:** `done`
- **Git:** `98f78f0`
- **Что сделано:**
  - реальный Playwright-backed runtime
  - `session open` открывает реальную страницу
  - `session observe`
  - `session snapshot`
  - screenshot + HTML snapshot artifacts
  - `BUGS.md`

### Commit 4 — Action layer v1
- **Статус:** `done`
- **Git:** `3c6d307`
- **Что уже сделано:**
  - `session act`
  - действия:
    - `navigate`
    - `click`
    - `fill`
    - `type`
    - `press`
    - `wait_for`
  - post-action summary
  - diffs/observations after action
  - правки эвристик классификации

### Commit 5 — LitRes pack skeleton
- **Статус:** `done`
- **Git:** `5b79465`
- **Что сделано:**
  - создан первый реальный pack `site-packs/litres/`
  - добавлены `manifest.json`, `instructions.md`, `login.md`, `checkout.md`, `hints.json`
  - добавлены placeholder-директории `learned/` и `approved/`
  - реализован pack loader/matcher по домену
  - `session open/context` теперь возвращают `packContext` с operational summary
  - добавлены тесты на загрузку/match pack и context summary

### Commit 6 — Session reuse for LitRes
- **Статус:** `next`
- **Уточнение:**
  - login должен стать частью обычного LitRes flow
  - не отдельным внешним предварительным шагом

### Commit 7 — LitRes search flow
- **Статус:** `partially proven manually`
- **Примечание:**
  - через текущий runtime уже подтверждён реальный поиск `1984`
  - но formal commit по этому этапу ещё не делался

### Commit 8 — LitRes add-to-cart + cart validation
- **Статус:** `not started`

### Commit 9 — OpenClaw skill integration v1
- **Статус:** `not started`

### Commit 10 — Traces v1 + MVP0 acceptance
- **Статус:** `not started`

---

## Что уже реально работает

### Infrastructure
- daemon живёт отдельно от одного CLI-вызова
- browser session state сохраняется внутри одного `sessionId`
- CLI стабильно отвечает JSON

### Browser runtime
- открыть страницу
- прочитать текущее состояние страницы
- сделать screenshot
- сохранить HTML snapshot

### Action layer
- fill
- press
- click
- wait_for
- navigate
- type

---

## Что уже проверено на LitRes

### Проверено успешно
- `https://www.litres.ru/` открывается
- `observe` возвращает осмысленное состояние страницы
- snapshot сохраняется
- найден реальный поисковый input
- подтверждено, что поиск на LitRes лучше матчится через:
  - `role="combobox"`
  - а не через обычный `textbox`
- выполнен поиск книги `1984`
- получена страница результатов:
  - URL: `https://www.litres.ru/search/?q=1984`
  - title: `Результаты поиска по книгам: «1984»`

### Проверено, но пока не работает как нужно
- `litres-sberid-login` запускается и уводит в Sber ID
- но авторизационный state **не подхватывается автоматически** в `browser-platform`
- после возврата на LitRes страница всё ещё выглядит анонимной (`Войти` виден)

---

## Известные проблемы / blockers

### Уже занесено в BUGS.md
- `BUG-001` — главная LitRes ошибочно классифицировалась как `auth_form` (`fixed`)
- `BUG-002` — LitRes home/search могут ошибочно классифицироваться как `cart` (`open`)

### Дополнительные blockers
- login state между:
  - `litres-sberid-login`
  - и `browser-platform`
  пока не склеен

---

## Что нужно сделать следующим

### Самый ближайший шаг
1. реализовать reuse авторизованного state для LitRes
2. встроить login в обычный LitRes flow

### После этого
3. довести сценарий:
   - search
   - open product
   - add to cart
   - open cart

---

## Практический вывод на сейчас

Проект уже вышел из стадии “голая идея”.

Сейчас у нас есть:
- живой daemon
- живой Playwright runtime
- рабочий `observe`
- рабочий `snapshot`
- рабочий `session act`
- первый реальный подтверждённый LitRes flow: **поиск `1984`**
- обновляемый `PROGRESS.md` как источник текущего статуса

Главный технический разрыв на текущий момент:

**auth context из login skill ещё не переиспользуется внутри browser-platform runtime.**

Именно это сейчас главный шаг к полноценному LitRes pilot.
