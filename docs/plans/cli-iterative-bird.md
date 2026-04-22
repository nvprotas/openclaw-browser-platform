# Ускорение LitRes e2e + точность brandshop в openclaw-browser-platform

## Context

Сейчас CLI/daemon работает стабильно для пилотного LitRes happy-path (search → product → cart → checkout → payecom → hardStop с extractionJson), но e2e сценарий покупки до `orderId JSON` дорогой по времени и хрупкий по нескольким причинам:

- Агент идёт через OpenClaw `exec` короткими шагами (`yieldMs ≤ 7000`), поэтому даже 8–15 логических действий превращаются в 8–15 последовательных HTTP roundtrip'ов CLI → daemon, и каждый act обязательно сопровождается `observe` (рекомендация в `openclaw/skill-template/SKILL.md:18-29`).
- На каждом шаге runtime платит дорогой overhead: payment-stabilization до 8×300ms (`src/runtime/run-step.ts:541-586`), запись `storageState` после open/observe/act (`src/playwright/browser-session.ts:621,932`, `src/playwright/controller.ts:120`), запись trace JSON, повторный `matchSitePackByUrl` (читает все 12 site-pack директорий ~5 раз за один `session open`: `src/daemon/server.ts:287,338,394,420` через `src/packs/loader.ts:56-84`).
- `runStep` сам делает `observe` до и после действия (`src/runtime/run-step.ts:599,727`), а endpoint `/v1/session/act` снова обновляет state через `touchUsage` — двойная DOM-evaluation на каждый act.
- Camoufox cold-start ~60s, контекст-pool в `BrowserContextPool` ключуется по `storageStatePath`, поэтому смена scenario при том же profile не реюзает browser, если path меняется.
- BUG-002 (`BUGS.md:85-157`) — page classification ошибочно ставит `cart` для home/search из-за слова "Корзина" в навигации; на brandshop это явный риск (`site-packs/brandshop/manifest.json:13` — `product_page_may_be_misdetected_as_cart`).
- Для brandshop отсутствуют helper'ы под обязательные шаги: cookie consent (`Принять`), выбор размера до add-to-cart, fallback при 404 на `/cart/`, проверка confirmation по cart-badge counter (`aria-label="cart"`).

Цель плана: ускорить LitRes e2e ~2× (target: search → orderId JSON ≤ 30s в тёплом профиле, против сегодняшних ~60–90s), повысить точность brandshop на pre-checkout flow (search → cart) и не сломать существующий JSON-контракт CLI.

## Approach

Шесть рабочих блоков. Все правки сохраняют существующие endpoint'ы и поля; новые поля добавляются опционально, новая команда — отдельная.

### Block 1 — Runtime hot-path для скорости

1. **In-memory cache для site-packs** — `src/packs/loader.ts:56-84`. Загрузить пакты один раз в module scope (lazy), хранить `Map<string, LoadedSitePack[]>` по `sitePacksRoot`. `matchSitePackByUrl` работает по уже разрешённому массиву. Это убирает 5×(12 директорий × 3 readFile) на каждый `session open`. Тест: counter readFile в unit-тесте.

2. **Дедуп `matchSitePackByUrl` внутри session open** — `src/daemon/server.ts:287,338,394,420`. Считать один раз и пробрасывать результат через локальную переменную в open flow. Сохранить trace-stage'ы (`match_site_pack_*`) для совместимости traces, но без повторного диск-IO.

3. **Throttle `persistStorageState`** — `src/playwright/browser-session.ts:644-650` + `src/playwright/controller.ts:120`. Ввести debounce: писать не чаще раз в 5s (timestamp в `BrowserSession`), всегда писать на `close()` и при auth-state transition (`anonymous → authenticated`). Удалить вызов из `controller.actInSession` в hot-path — переехать в фоновый flush.

4. **Снизить дефолтный stabilize budget** — `src/runtime/run-step.ts:527-589`. Сейчас 8×300ms = 2.4s. Сделать early-exit fast-path: 3×200ms (600ms) с расширением до 8×300ms только если `before.paymentContext.phase === 'litres_checkout' && !after.paymentContext.terminalExtractionResult` (т.е. ещё не дошли до payecom). Сохранить выход по `terminalExtractionResult || phase === 'payecom_boundary'`.

5. **Async (fire-and-forget) trace writes** — `src/daemon/server.ts:472,546,623,668` через `src/helpers/tracing.ts`. Очередь записи (простой in-memory) flush'ится non-blocking; HTTP-ответ возвращается сразу. На `daemon stop` / `session close` дожидаемся flush.

6. **Опциональный `onlyChanged` для observe внутри runStep** — `src/runtime/run-step.ts:599`. Если caller (`actInSession`) уже сделал observe в текущем тике, передавать его как `before`; иначе делать как раньше. Это убирает duplicate DOM-eval до action в большинстве act-вызовов.

### Block 2 — Deterministic macro `session run-scenario` (главное ускорение для агента)

Новая локальная орчестрация внутри daemon — без HTTP-roundtrip'ов на каждый шаг. CLI:

```bash
browser-platform session run-scenario \
  --pack litres \
  --flow checkout-to-orderid \
  --query "Задача трех тел" \
  --profile litres \
  --max-duration-ms 60000 \
  --json
```

Endpoint: `POST /v1/session/run-scenario` (новый, `src/daemon/server.ts`). Логика — в `src/runtime/scenarios/litres-checkout.ts` (новый файл), переиспользует уже готовое:
- `src/helpers/search.ts` — `fillSearchAndSubmit`, `chooseSearchResultTarget`
- `src/helpers/cart.ts` — `findAddToCartTargets`, `findOpenCartTargets`, `isAddToCartConfirmed`, `isCartVisible`
- `src/helpers/payment-context.ts` — `extractPaymentContext`
- `src/helpers/hard-stop.ts` — `buildHardStopSignal`

Шаги внутри одного процесса (нет CLI roundtrip'ов):
1. `session.open(url)` или сразу `https://www.litres.ru/search/?q=…` (избегаем шага fillSearch).
2. `chooseSearchResultTarget` → click первого матча → `runStep`.
3. `findAddToCartTargets` → first-success click → `isAddToCartConfirmed`.
4. `findOpenCartTargets` → first-success click → `isCartVisible`.
5. Click "Перейти к покупке" (новый pack hint `checkout_proceed`).
6. Pre-submit guard: если `paymentContext.paymentMethod === 'sbp'` — навигация по URL c `method=russian_card&system=sbercard` (как описано в `site-packs/litres/instructions.md:24`). Fallback на `label[for="payment-method-input-russian_card"]`.
7. Click `paymentLayout__payment--button` (Продолжить).
8. Polling до `terminalExtractionResult || timeout` — без дополнительных observe HTTP-вызовов.
9. Возврат: `{ ok: true, sessionId, hardStop, finalPayload, stages: [...] }` или `{ ok: false, reason, sessionId, lastObservation }` для diagnostic.

Агент вызывает одну команду с `yieldMs:7000` и пуллит через стандартный OpenClaw `process(action=poll)`. Сценарий не делает финальный `Оплатить` (явное ограничение в `site-packs/litres/checkout.md:24`).

CLI plumbing: `src/cli/commands/session.ts`, `src/cli/main.ts`, `src/daemon/client.ts`. Контракт — отдельный, не трогает существующий `session act`.

### Block 3 — Точность brandshop

1. **Fix BUG-002 в `guessPageSignature`** — `src/playwright/browser-session.ts:904-920`. Снять правило 5 (классификация `cart` без URL-сигнала). Новые правила:
   - `cart` ставится только если URL содержит `/cart/|/basket/|/checkout/` или есть order-summary signals (`Оформить заказ`, `Состав заказа`, `Ваша корзина`).
   - Для brandshop явно: URL `/goods/` всегда → `product_page` независимо от наличия "Корзина" в шапке.
   - Регрессионный unit-тест с фикстурами home/search/product brandshop и LitRes.

2. **Cookie consent helper** — новый `src/helpers/consent.ts`. Single-shot dismiss: при `runStep` для click/fill, если в visible buttons есть match по `cookie_consent.accept_texts` из pack hints, кликнуть до основного действия. Добавить в `site-packs/brandshop/hints.json`:
   ```json
   "cookie_consent": {
     "accept_texts": ["Принять", "Принимаю", "Согласен"],
     "selectors": ["button:has-text('Принять')", "[class*='cookie'] button"]
   }
   ```

3. **Size-selection helper** — новый `src/helpers/size-select.ts`. Перед `findAddToCartTargets` для brandshop: найти контейнер `Доступные размеры`, выбрать первый available size-plate (исключить `_disabled`/`disabled`/`_unavailable`). Интегрировать как pre-step в scenario macro и как опциональную проверку для агента (через observation `SIZE_SELECTION_REQUIRED`).

4. **Cart-badge counter check** — расширить `isAddToCartConfirmed` (`src/helpers/cart.ts:59-107`). Добавить путь: парсить `aria-label="cart"` элемент или ближайший counter (`*[class*="cart"] *[class*="counter"]`) и сравнить before/after. Это generic — пригодится не только brandshop.

5. **Cart-direct fallback на header icon** — `findOpenCartTargets` уже возвращает массив; добавить в brandshop hints приоритет `button[aria-label="cart"]` перед `a[href*='/checkout']`. Для `runFirstSuccessfulAction`-стиля helper'а добавить detect 404 в observation: если `pageSignatureGuess === 'unknown' && visibleTexts contains "404"`, считаем target неудачным и переходим к следующему.

6. **brandshop instructions** — обновить `site-packs/brandshop/instructions.md` под новые helper'ы (cookie consent, size selection, cart fallback).

### Block 4 — Auth speedup для LitRes (опционально, win ~10–15s)

1. **Targeted wait вместо networkidle** — `src/playwright/waits.ts:3-9` уже race с 500ms timeout, но bootstrap (`src/daemon/litres-auth.ts:134-147`) ждёт 45s loop. Заменить generic `waitForLoadState('networkidle')` на targeted `waitFor` для известных auth gate selectors.

2. **Skip bootstrap при свежем storage-state** — добавить TTL-чек в `src/daemon/profile-state.ts`: если `storage-state.json` mtime < N (default 60 минут) **и** quick observe показывает `auth_state === 'authenticated'`, пропустить весь bootstrap-flow.

### Block 5 — Contract evolution (совместимо)

1. **Новое поле `session.nextRecommendedAction`** в response `/v1/session/act` и `/v1/session/observe`. Значения: `"observe_now" | "skip_observe" | "wait_for_hardstop" | "run_scenario_recommended"`. Старые клиенты игнорируют.

2. **Обновить `openclaw/skill-template/SKILL.md`**: рекомендация перейти на `session run-scenario` для LitRes покупочных задач; для произвольных — observe → act loop остаётся, но с подсказками `nextRecommendedAction`.

3. **Документировать новое поле и команду** в `README.md` и `ARCHITECTURE_CURRENT.md`.

### Block 6 — Регрессионные тесты

- `tests/unit/page-classification.test.ts` (новый) — фикстуры home/search/product/cart для LitRes и brandshop, проверка отсутствия `home→cart` и `product→cart` misclassification.
- `tests/unit/site-pack-cache.test.ts` (новый) — счётчик readFile при N вызовах `matchSitePackByUrl`.
- `tests/unit/storage-state-throttle.test.ts` — счётчик `context.storageState({path})` в N подряд act'ах.
- `tests/unit/scenarios-litres-checkout.test.ts` — mock BrowserSession, прогон сценария до `hardStop`.
- `tests/unit/cookie-consent.test.ts`, `tests/unit/size-select.test.ts` — helper unit-тесты.
- `tests/integration/cli-daemon.test.ts` — расширить existing mock-сценарий вызовом нового `session run-scenario` против локального HTTP fixture (без реального LitRes).

## Critical files

**Правка:**
- `src/runtime/run-step.ts` — stabilize budget, опциональный double-observe (Block 1.4, 1.6)
- `src/playwright/browser-session.ts:644-650, 904-920` — persistStorageState throttle, guessPageSignature fix (Block 1.3, 3.1)
- `src/playwright/controller.ts:120` — убрать persist из hot-path (Block 1.3)
- `src/daemon/server.ts` — дедуп matchSitePackByUrl, async traces, новый `/v1/session/run-scenario` endpoint, поле `nextRecommendedAction` (Block 1.2, 1.5, 2, 5.1)
- `src/packs/loader.ts:56-84` — in-memory cache (Block 1.1)
- `src/helpers/cart.ts:59-107` — cart-badge counter check (Block 3.4)
- `src/helpers/tracing.ts` — async write queue (Block 1.5)
- `src/cli/commands/session.ts`, `src/cli/main.ts`, `src/daemon/client.ts` — CLI/HTTP plumbing для `run-scenario` (Block 2)
- `src/daemon/litres-auth.ts:134-147` — targeted wait (Block 4.1)
- `src/daemon/profile-state.ts` — TTL skip-bootstrap (Block 4.2)
- `site-packs/brandshop/hints.json`, `instructions.md` — cookie consent + size + cart fallback (Block 3.2, 3.5, 3.6)
- `site-packs/litres/hints.json` — `checkout_proceed` button hints (Block 2)
- `openclaw/skill-template/SKILL.md` — обновление контракта (Block 5.2)

**Новые:**
- `src/runtime/scenarios/litres-checkout.ts` — orchestrator (Block 2)
- `src/helpers/consent.ts` — cookie consent (Block 3.2)
- `src/helpers/size-select.ts` — size selection (Block 3.3)
- Файлы тестов выше (Block 6)

## Verification

1. `npm run build && npm run test` — всё зелёное, новые unit-тесты покрывают cache, throttle, page-classification, scenarios.
2. `npm run lint && npm run format:check`.
3. Локальный smoke с тёплым профилем (`~/.openclaw/workspace/tmp/sberid-login/litres/storage-state.json` существует):
   ```bash
   time browser-platform session run-scenario --pack litres \
     --flow checkout-to-orderid --query "Задача трех тел" --json
   ```
   Ожидание: `hardStop.finalPayload.paymentOrderId` присутствует, время ≤ 30s (baseline ~60–90s).
4. Сравнительный smoke на старом пути (агентский цикл observe→act):
   ```bash
   node --import tsx examples/demo-litres-cart.ts "Задача трех тел"
   ```
   Должен по-прежнему работать (контракт совместим), время сократится за счёт throttle/cache/early-exit.
5. brandshop manual smoke:
   ```bash
   browser-platform session open --url https://brandshop.ru/ --profile brandshop --json
   browser-platform session context --session <ID> --json   # context.packContext === brandshop
   browser-platform session act --session <ID> --json '{"action":"navigate","url":"https://brandshop.ru/search/?q=кроссовки"}'
   browser-platform session observe --session <ID> --json   # pageSignatureGuess === 'search_results', НЕ 'cart'
   ```
   Открыть товар, добавить в корзину через helper-flow, убедиться что size-selection срабатывает и cookie-баннер закрывается.
6. Метрики (логировать в trace и проверить вручную):
   - file-reads на pack loading за один `session open` — было 12×3×~5 = ~180, стало ≤ 36 (один проход на старте daemon).
   - `persistStorageState` вызовов за 8 act'ов — было ~9, стало ≤ 3.
   - HTTP roundtrip'ов CLI→daemon на e2e checkout — было ≥ 12, через `run-scenario` стало 1 (+ poll).
   - DOM evaluations per act — было ≥ 3 (без stabilize) / до 11 (со stabilize), стало ≤ 2 / ≤ 5.
