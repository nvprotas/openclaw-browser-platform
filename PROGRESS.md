# PROGRESS.md

Текущий прогресс по `openclaw-browser-platform`.

Последнее обновление: **2026-03-31 20:56 UTC**

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
- выполнен свежий live-run после очистки runtime-context в `~/.openclaw/workspace`: удалось снова пройти реальный LitRes flow `home -> search 1984 -> product -> add to cart -> cart`; добавление в корзину подтверждено изменением хедера на `1 Корзина`
- на кнопке `Перейти к покупке` достигнут checkout entry, но вместо продолжения к оформлению появляется login gate `Авторизуйтесь для покупки`; после `Другие способы -> Sber` живой flow уходит на внешний `id.sber.ru`, то есть текущая checkout boundary / handoff для реального сайта подтверждена и зафиксирована скриншотами в Telegram
- в знания LitRes skill/runtime добавлено явное правило: если в видимом UI всё ещё есть кнопка `Войти`, агент должен считать, что на сайте он ещё не авторизован, даже если одновременно видны account-like сигналы вроде `Мои книги`; правило синхронизировано в `site-packs/litres/instructions.md`, `site-packs/litres/login.md`, `openclaw/skill-template/SKILL.md` и workspace skill `skills/litres-sberid-login/SKILL.md`
- live checkout-run расширен дальше payment chooser: подтверждён same-session путь `cart -> Перейти к покупке -> Другие способы -> Sber -> Оформление покупки`; на payment choice странице подтверждено, что `СБП` и `SberPay` — разные ветки
- подтверждён реальный flow `Российская карта -> Продолжить -> payecom.ru/pay`; внутри payecom найден отдельный SberPay entry как `Войти по Сбер ID`, и его выбор доводит страницу до списка привязанных карт/вариантов оплаты без нажатия финальной `Оплатить`
- новые checkout/payment знания синхронизированы в `site-packs/litres/instructions.md`, `site-packs/litres/checkout.md` и `site-packs/litres/hints.json`
- исправлен workflow на будущее: если на checkout boundary появляются payment identifiers, агент должен сообщать их немедленно; это зашито и в skill layer (`openclaw/skill-template/SKILL.md`, `skills/sberpay-payment-extract/SKILL.md`), и в LitRes pack notes (`site-packs/litres/instructions.md`, `site-packs/litres/checkout.md`)
- в `browser-platform` добавлен новый `paymentContext`: runtime теперь извлекает payment hints/IDs прямо из `session open/observe/act/snapshot/context`, включая `paymentOrderId`, LitRes `order`, `traceId`, `paymentUrl`, payment branch/provider, а также URL hints вроде `payecom` iframe/src и `id.sber.ru` handoff links
- post-action observations теперь поднимают явный сигнал `PAYMENT_IDS_DETECTED` с инструкцией «report them before continuing», чтобы агент не протягивал найденный `orderId` до конца сценария
- после замечания пользователя семантика tightened: на payment boundary агент должен не просто писать prose-сообщение, а возвращать structured JSON в формате `sberpay-payment-extract`; это зафиксировано в `openclaw/skill-template/SKILL.md`, `site-packs/litres/instructions.md`, `site-packs/litres/checkout.md` и workspace skill `skills/sberpay-payment-extract/SKILL.md`
- `browser-platform` расширен полем `paymentContext.extractionJson`, которое повторяет extractor schema (`paymentMethod`, `paymentUrl`, `paymentOrderId`, `paymentIntents`, `bankInvoiceId`, `merchantOrderNumber`, `merchantOrderId`, `rawDeeplink`, `source`, `mdOrder`, `formUrl`, `href`); `shouldReportImmediately` теперь означает, что этот JSON уже готов и его нужно отдать до следующего шага
- наблюдения `PAYMENT_IDS_DETECTED` теперь прямо подсказывают вернуть `paymentContext.extractionJson as JSON before continuing`; сборка и targeted tests (`auth-state`, `payment-context`, `packs-loader`, `site-pack-context`) после правки снова зелёные
- после живого прогона с книгой `Задача трех тел` усилен payment runtime: `run-step` теперь делает короткий post-click stabilization/polling на checkout/payment шагах, чтобы поздно появляющиеся сигналы вроде `payecom` iframe, `Войти по Сбер ID` и handoff URLs успевали попасть в обычный action result без ручного HTML-снапшота
- в tracing/validation добавлены более точные payment observations: `SBERPAY_ENTRY_VISIBLE`, `SBER_ID_HANDOFF_VISIBLE`, а вместо грубого `NO_OBVIOUS_CHANGE` на живом payment flow теперь может возвращаться `PAYMENT_FLOW_STILL_ACTIVE`
- в `openclaw/skill-template/SKILL.md` и `site-packs/litres/checkout.md` зафиксирован stop-condition: если пользователь просил именно дойти до SberPay, задача считается выполненной при достижении ветки `payecom` / `Войти по Сбер ID` и возврате structured JSON; финальный `Оплатить` без отдельного явного запроса не нажимать
- Commit 7 по LitRes search formalized: helper `src/helpers/search.ts`, пример `examples/demo-litres-search.ts` и тесты теперь закрывают flow `home -> search -> search_results -> product` без вмешательства в auth/payment boundary
- build/test после этих правок снова зелёные: `npm run build` и targeted `vitest` (`auth-state`, `payment-context`, `packs-loader`, `site-pack-context`) прошли успешно
- добавлены unit tests для payment extraction/observation logic; после этого `npm run build` и targeted `vitest` (`auth-state`, `payment-context`, `packs-loader`, `site-pack-context`) снова зелёные; заодно увеличены лимиты `instructions summary` и `knownSignals`, чтобы новые checkout notes не вытесняли старые critical signals из runtime context
- проведена проверка installer rerun/update semantics на уже установленной копии: локальный `./install.sh` и bootstrap-режим поверх существующего `TARGET_DIR` повторно отрабатывают и накатывают изменения (в том числе обновление `openclaw/skill-template/SKILL.md` в workspace skill); найден и исправлен edge case, где rerun падал на `Existing repo remote mismatch`, если один и тот же remote был задан эквивалентными, но не идентичными строками (`file://...` vs локальный путь, GitHub HTTPS vs SSH); после правки `install.sh` нормализует URL remote перед сравнением, а repro-проверки `bash -n install.sh`, локальный rerun и bootstrap rerun на existing target снова зелёные
- в начало `README.md` добавлена явная one-liner команда обновления/установки через GitHub raw install script: `curl -fsSL https://raw.githubusercontent.com/nvprotas/openclaw-browser-platform/master/install.sh | RUN_TESTS=0 bash`

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
- **Статус:** `done`
- **Что закрыто:**
  - оформлен helper-модуль `src/helpers/search.ts` для поиска search input, submit targets и эвристики открытия карточки из `search_results`
  - LitRes pack hints расширены селектором `search_result_link`
  - добавлен пример `examples/demo-litres-search.ts`
  - добавлены unit/integration tests, формально доказывающие flow `home -> search -> search_results -> product`

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
