# PROGRESS.md

Текущий прогресс по `openclaw-browser-platform`.

Последнее обновление: **2026-03-31 15:55 UTC**

## Короткий статус

- Commit 5 завершён и зафиксирован в git как `5b79465`
- добавлена схема текущей архитектуры в `ARCHITECTURE_CURRENT.md`
- LitRes уже тестируется на живом сайте
- поиск `1984` через новый runtime уже работает
- `Commit 6.1` реализован и запушен как `998608a`
- LitRes bootstrap/login attempt теперь встроен в normal `session open` flow
- LitRes bootstrap ownership перенесён внутрь repo; зависимость от workspace script path убрана
- `authContext` расширен явными bootstrap outcome-флагами (`handoffRequired`, `bootstrapFailed`, `redirectedToSberId`, `bootstrapStatus` и др.)
- build/test/lint проходят после интеграции bootstrap path
- ранний live smoke-тест repo-owned bootstrap показывал только redirect до Sber ID, но после ручной нормализации `sameSite` и повторного чистого прогона был подтверждён usable authenticated state
- при свежем прогоне `session context` уже корректно возвращает `authContext` (BUG-003 больше не воспроизводится)
- сделан визуальный live-тест новой repo-owned LitRes bootstrap реализации с debug screenshots: цепочка `login page -> Другие способы -> Sber redirect` подтверждена
- на полностью чистом прогоне repo-owned bootstrap сначала упирался в raw `sameSite` values из `sber-cookies.json`, после ручной нормализации cookies чистый прогон снова стал проходить через bootstrap path
- на свежем `storage-state` repo-owned bootstrap дошёл до redirect на Sber ID, а последующий `session open` уже дал `authState = authenticated`
- после этого на live LitRes подтверждён уже и authenticated search flow: главная открывается в авторизованном состоянии, модалка объединения профилей закрывается, поиск `1984` доводится до страницы результатов
- практические знания из живого прогона записаны в LitRes pack: search submit через кнопку `Найти` и селектор закрытия post-login модалки
- увеличен лимит `instructions summary` в pack parser, чтобы новые LitRes operational notes не выпадали из runtime context; build/test/lint снова зелёные
- `site-packs/litres/login.md` синхронизирован с текущим repo-owned LitRes auth flow и больше не содержит устаревший placeholder про purely external login step
- проведена быстрая ревизия остальных LitRes pack-файлов: явный устаревший хвост найден только в `manifest.json` (`login_may_require_external_bootstrap` -> `login_may_require_human_handoff`); связанная строка в `MVP0_LITRES.md` тоже обновлена; targeted pack tests зелёные
- в план добавлен следующий безопасный checkout шаг: дойти до payment boundary и, если появляется SberPay intent (`payecom` / `platiecom` / `formUrl` / related fields), извлекать payment identifiers в structured JSON без попытки подтвердить оплату; это отражено в `ROADMAP.md` и `MVP0_LITRES.md`
- репозиторий подготовлен к дистрибуции в текущем виде: `playwright` перенесён в runtime dependencies, добавлены `files` + `prepack` в `package.json`, расширен `README.md`, добавлены `docs/OPENCLAW_SETUP.md` и `docs/DISTRIBUTION.md`, а также готовый `openclaw/skill-template/SKILL.md` для подключения к чистому OpenClaw; `npm run build`, `npm test` и `npm pack --dry-run` прошли зелёно
- `install.sh` усилен до dual-mode installer: тот же файл теперь работает и как repo-local `./install.sh`, и как будущий bootstrap one-liner `curl ... | bash` (в non-local режиме он сам клонирует/обновляет repo в `TARGET_DIR`, затем запускает локальный install)
- обновлены `README.md`, `docs/OPENCLAW_SETUP.md`, `docs/DISTRIBUTION.md` под one-liner UX; safe-проверки зелёные: `bash -n install.sh`, локальный `RUN_TESTS=0 RESTART_GATEWAY=0 RUN_SMOKE_TEST=0 SKILL_MODE=skip ./install.sh`, и bootstrap-smoke `cat install.sh | ... bash` на временном локальном git-репо прошли успешно

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
- **Статус:** `done`
- **Git:** `ac5de58`
- **Что сделано:**
  - `session open` теперь умеет принимать `--storage-state <path>`
  - для LitRes добавлен auto-pick bootstrap path: `/root/.openclaw/workspace/tmp/sberid-login/litres/storage-state.json`
  - storage state подхватывается внутри normal browser-platform flow, а не как отдельный ручной pre-step
  - в `session open/context` появился `authContext`:
    - `authenticated`
    - `anonymous`
    - `login_gate_detected`
    - `bootstrapAttempted`
    - `bootstrapSource`
    - `storageStatePath`
    - `storageStateExists`
  - auth state пересчитывается также после `observe` / `act` / `snapshot`
  - добавлены тесты на reuse storage state и login gate detection

### Commit 6.1 — Full Sber ID login inside browser-platform flow
- **Статус:** `done`
- **Git:** `998608a`
- **Что сделано:**
  - `session open` для LitRes теперь не только reuse-ит storage state, но и при необходимости запускает встроенный bootstrap attempt
  - bootstrap implementation теперь живёт внутри repo (`src/daemon/litres-auth.ts`), а не во внешнем workspace skill script
  - bootstrap path по умолчанию всё ещё использует существующие артефакты Sber/LitRes (`sber-cookies.json`, `tmp/sberid-login/litres/storage-state.json`)
  - после bootstrap runtime переоткрывает ту же LitRes session уже с обновлённым storage state
  - `authContext` расширен полями:
    - `handoffRequired`
    - `bootstrapFailed`
    - `redirectedToSberId`
    - `bootstrapStatus`
    - `bootstrapScriptPath`
    - `bootstrapOutDir`
    - `bootstrapFinalUrl`
    - `bootstrapError`
  - storage state теперь также persist-ится из самого browser runtime после open/observe/act/snapshot
  - добавлены/обновлены unit tests под bootstrap outcome

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
- после repo-owned auth flow и нормализации `sameSite` подтверждён повторный поиск `1984` уже в **authenticated session**
- подтверждено, что после логина может всплывать модалка объединения профилей; после её закрытия поиск продолжает работать

### Проверено по auth flow
- repo-owned LitRes bootstrap path открывает `https://www.litres.ru/auth/login/`
- успешно раскрывает `Другие способы`
- после клика по Sber уходит на `id.sber.ru`
- `session context` корректно показывает `authContext`
- после ручной нормализации `sameSite` в `sber-cookies.json` чистый прогон с новым пустым `storage-state` path дал такой результат:
  - bootstrap: `redirected_to_sberid`
  - затем обычный `session open`: `authState = authenticated`
- то есть repo-owned flow уже может довести новый state до usable authenticated session, если входные cookies читаются Playwright без ошибки формата

---

## Известные проблемы / blockers

### Уже занесено в BUGS.md
- `BUG-001` — главная LitRes ошибочно классифицировалась как `auth_form` (`fixed`)
- `BUG-002` — LitRes home/search могут ошибочно классифицироваться как `cart` (`open`)
- `BUG-003` — `session context` не показывал `authContext` в CLI output после Commit 6/6.1 (`fixed`)

### Дополнительные blockers
- нужно перенести нормализацию cookies в код repo-owned bootstrap, чтобы он не зависел от ручной правки `sber-cookies.json`
- нужно формализовать обработку модалки объединения профилей как части authenticated LitRes flow
- нужно подтвердить стабильность уже authenticated flow на следующих шагах:
  - open product
  - add to cart
  - open cart

---

## Что нужно сделать следующим

### Самый ближайший шаг
1. встроить нормализацию cookies в repo-owned bootstrap path, чтобы убрать зависимость от ручного исправления `sber-cookies.json`
2. формализовать обработку модалки объединения профилей как части authenticated LitRes flow

### После этого
3. довести сценарий:
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

**repo-owned LitRes bootstrap уже может доводить flow до usable authenticated state, а authenticated search flow уже подтверждён; теперь нужно убрать зависимость от ручной правки cookies и формализовать обработку модалки после логина.**

Именно это сейчас главный шаг к полноценному LitRes pilot.
