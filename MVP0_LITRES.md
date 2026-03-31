# MVP0 — LitRes pilot plan

Это не общий roadmap, а **приземлённый execution plan** для первого рабочего трека.

Цель: доказать, что связка

```text
OpenClaw skill -> exec -> browser-platform CLI -> daemon -> Playwright
```

реально работает на **одном живом сайте — LitRes**.

---

## 1. Что считаем успехом MVP0

К концу MVP0 система должна уметь:

1. открыть `litres.ru`
2. подхватить уже существующее авторизованное состояние, если оно доступно
3. найти книгу по запросу
4. открыть карточку книги
5. добавить книгу в корзину
6. открыть корзину
7. записать trace так, чтобы было понятно:
   - что произошло
   - на каком шаге сломалось
   - какие элементы были видны
   - какие сигналы успеха/неуспеха зафиксированы

### Что НЕ входит в MVP0
- реализация полного Sber ID login flow внутри browser-platform
- финальный платёжный шаг
- VNC handoff lifecycle
- auto-learning из демонстраций
- native OpenClaw plugin

---

## 2. LitRes pilot flow v1

Первый эталонный сценарий:

```text
restore session
-> open home
-> search book
-> open product page
-> add to cart
-> open cart
-> stop
```

### Почему именно этот flow
Потому что он покрывает почти всё нужное для архитектуры MVP0:
- session reuse
- page classification
- поиск
- действие на карточке
- валидацию результата
- навигацию в корзину
- traces

---

## 3. Договоримся о LitRes-specific scope

## 3.1 Что считаем поддерживаемыми page states
На MVP0 нужно уметь хотя бы различать:
- `home`
- `search_results`
- `product_page`
- `cart`
- `login_gate`
- `unknown`

## 3.2 Какие сигналы считаем полезными
На MVP0 надо собирать хотя бы такие сигналы:
- текущий URL
- title страницы
- видимые CTA-кнопки
- наличие строки поиска
- наличие cart badge / cart link
- изменение cart-related UI после add-to-cart

## 3.3 Что считать успешным add-to-cart
Успех можно считать подтверждённым, если выполняется хотя бы одно:
- изменилась cart badge count
- появилась UI-индикация добавления
- кнопка изменила состояние
- в cart drawer / cart preview появился товар

---

## 4. Структура первого LitRes pack

```text
site-packs/litres/
  manifest.json
  instructions.md
  login.md
  checkout.md
  hints.json
  learned/
    candidate-flows.json
    candidate-selectors.json
    candidate-signals.json
    notes.md
  approved/
    flow-notes.json
    validation-rules.json
```

### Что должно быть внутри сразу

#### `manifest.json`
- `site_id: "litres"`
- `domains: ["litres.ru", "www.litres.ru"]`
- `support_level: "profiled"`
- `flows: ["search", "open_product", "add_to_cart", "open_cart"]`
- `risk_flags.payment_requires_human: true`
- `risk_flags.login_may_require_human_handoff: true`

#### `instructions.md`
Текстом:
- как обычно пользоваться поиском на LitRes
- что считать карточкой книги
- как обычно выглядит add-to-cart
- как понять, что товар добавлен
- как перейти в корзину
- когда нужно остановиться

#### `hints.json`
- candidate button texts
- candidate landmarks
- candidate selectors for search/cart/add-to-cart
- page signatures

---

## 5. Commit-by-commit план

## Commit 1 — Bootstrap + repo skeleton

### Что сделать
- выбрать и зафиксировать package manager
- создать `package.json`
- добавить `tsconfig.json`
- подключить:
  - `playwright`
  - `vitest`
  - `eslint`
  - `prettier`
  - `tsx` или аналог для dev-run
- создать базовую структуру директорий:
  - `bin/`
  - `src/cli/`
  - `src/daemon/`
  - `src/playwright/`
  - `src/helpers/`
  - `src/packs/`
  - `src/traces/`
  - `site-packs/litres/`
  - `examples/`
  - `tests/`

### Артефакты
- `package.json`
- `tsconfig.json`
- `playwright.config.ts`
- `bin/browser-platform.ts`
- базовые пустые директории

### Done when
- проект ставится с нуля
- `lint`, `test`, `build` запускаются
- есть рабочий entrypoint CLI

---

## Commit 2 — CLI + daemon skeleton

### Что сделать
Собрать минимальный stateful bridge.

### Команды, которые должны появиться
- `browser-platform daemon ensure --json`
- `browser-platform daemon status --json`
- `browser-platform session open --url ... --json`
- `browser-platform session context --session ... --json`
- `browser-platform session close --session ... --json`

### Внутри
- daemon process / server
- session registry
- JSON protocol между CLI и daemon
- health/status response

### Артефакты
- `src/cli/main.ts`
- `src/cli/commands/daemon.ts`
- `src/cli/commands/session.ts`
- `src/daemon/server.ts`
- `src/daemon/session-registry.ts`
- `src/daemon/state-store.ts`

### Done when
- можно поднять daemon
- можно открыть session и получить `sessionId`
- session переживает несколько CLI-вызовов подряд

---

## Commit 3 — Playwright runtime v1

### Что сделать
Подключить реальный browser control.

### Что должно уметь runtime
- открыть браузер/контекст/страницу
- загрузить URL
- сделать screenshot
- снять HTML/DOM snapshot
- вернуть текущее состояние страницы

### Команды, которые должны заработать
- `browser-platform session observe --session ... --json`
- `browser-platform session snapshot --session ... --json`

### Что должно возвращать `observe`
- `sessionId`
- `url`
- `title`
- `visibleTexts` или короткий extracted summary
- `visibleButtons`
- `forms`
- `pageSignatureGuess`

### Артефакты
- `src/playwright/browser-session.ts`
- `src/playwright/controller.ts`
- `src/playwright/waits.ts`
- `src/playwright/snapshots.ts`
- `src/playwright/dom-utils.ts`

### Done when
- можно открыть `litres.ru`
- можно получить осмысленный JSON snapshot состояния страницы

---

## Commit 4 — Action layer v1

### Что сделать
Добавить минимальный управляемый action surface.

### Команда
- `browser-platform session act --session ... --json '<payload>'`

### Какие action нужны на MVP0
- `navigate`
- `click`
- `fill`
- `type`
- `press`
- `wait_for`

### Что важно
После действия должен возвращаться не только `ok`, но и post-action state summary:
- новый URL
- title
- changed buttons
- page signature guess
- possible success signals

### Артефакты
- `src/runtime/run-step.ts`
- `src/helpers/validation.ts`
- `src/helpers/retries.ts`
- `src/helpers/tracing.ts`

### Done when
- можно руками через CLI пройти 2–3 действия подряд на LitRes
- агент сможет работать в цикле observe -> act -> observe

---

## Commit 5 — LitRes pack skeleton

### Что сделать
Собрать первый реальный site pack.

### Файлы
- `site-packs/litres/manifest.json`
- `site-packs/litres/instructions.md`
- `site-packs/litres/login.md`
- `site-packs/litres/checkout.md`
- `site-packs/litres/hints.json`
- `site-packs/litres/learned/...`
- `site-packs/litres/approved/...`

### Что должно быть в `instructions.md`
- как искать книгу
- как выглядит карточка
- какие CTA встречаются
- как понять успешный add-to-cart
- как открыть корзину
- где остановиться

### Что должно быть в `hints.json`
- тексты кнопок поиска / добавления / корзины
- candidate selectors
- признаки `search_results`, `product_page`, `cart`

### Артефакты
- `src/packs/manifest.ts`
- `src/packs/loader.ts`
- `src/packs/instructions.ts`
- `src/packs/hints.ts`

### Done when
- по URL `litres.ru` runtime подхватывает pack `litres`
- в session context видно summary pack-информации

---

## Commit 6 — Session reuse for LitRes

### Что сделать
Научиться использовать уже существующее авторизованное состояние **как часть обычного browser-platform flow**.

### Важно
Login не должен оставаться отдельным внешним ритуалом перед запуском browser-platform.  
`browser-platform` сам должен уметь:
- подхватить существующий LitRes auth state
- показать текущее auth-состояние в `session open/context`
- встроить bootstrap/reuse в обычный flow открытия LitRes session

### Что нужно технически
- configurable storage-state input
- auto-pick LitRes storage state
- загрузка storage state при открытии session
- проверка: мы авторизованы или попали на login gate
- возврат `authState` / `authContext` в session context:
  - `authenticated`
  - `anonymous`
  - `login_gate_detected`
  - `bootstrapAttempted`
  - `bootstrapSource`

### Важная реализационная оговорка
На этом этапе не изобретать второй отдельный login-механизм.  
Нужно опираться на уже существующий `litres-sberid-login` skill и его артефакты:
- `/root/.openclaw/workspace/skills/litres-sberid-login/`
- `/root/.openclaw/workspace/tmp/sberid-login/litres/storage-state.json`

То есть существующий skill — это источник bootstrap-логики и storage-state, а `browser-platform` — основной runtime, который должен уметь это использовать внутри normal flow.

### Артефакты
- `src/playwright/auth-state.ts`
- `src/helpers/login-gates.ts`
- правки в `session open`

### Done when
- можно открыть LitRes session в уже авторизованном состоянии
- runtime умеет явно сказать, авторизованы мы или нет
- auth reuse больше не выглядит как внешний ручной pre-step

---

## Commit 6.1 — Full Sber ID login inside browser-platform flow

### Что сделать
Добавить полноценную попытку login/bootstrap внутри обычного LitRes flow на случай, когда reusable state нет или он невалиден.

### Важно
Это не значит «переписать весь Sber ID с нуля».  
Нужно встроить в browser-platform практичный login path, который **использует существующий skill как основу**, но воспринимается архитектурно как часть обычного LitRes runtime flow.

### Что нужно технически
- встроенный bootstrap attempt из `session open` / auth-resolution logic
- переход на `https://www.litres.ru/auth/login/`
- запуск login/bootstrap path для Sber ID
- сохранение обновлённого storage state после успешного шага
- расширение `authContext`, например:
  - `bootstrap_attempted`
  - `handoff_required`
  - `bootstrap_failed`
- возможность позже продолжить тот же LitRes flow после auth

### Что считать MVP-результатом
- если валидный state уже есть — он используется автоматически
- если state нет — browser-platform сам делает встроенный bootstrap attempt
- если нужен человек (OTP/подтверждение/неожиданный шаг), это рассматривается как часть flow, а не как внешний отдельный ритуал

### Ожидаемое ограничение
На MVP допустимо, что полностью автономный Sber ID login не всегда проходит до конца.  
Главное — чтобы архитектурно login был встроен в flow, а не жил отдельно от browser-platform.

---

## Commit 7 — LitRes search flow

### Что сделать
Довести до рабочего сценарий:
- открыть главную
- ввести запрос
- получить результаты
- открыть карточку книги

### Что для этого нужно
- helper `findSearchInput`
- helper `fillSearchAndSubmit`
- page signature rules для `search_results`
- эвристика выбора карточки результата

### Артефакты
- `src/helpers/search.ts`
- обновление `site-packs/litres/hints.json`
- `examples/demo-litres-search.ts`

### Done when
- по текстовому запросу можно стабильно дойти до карточки книги

---

## Commit 8 — LitRes add-to-cart + cart validation

### Что сделать
Довести ключевую часть пилота:
- с карточки книги добавить в корзину
- подтвердить успех
- открыть корзину

### Для этого нужно
- helper поиска CTA add-to-cart
- post-click validation
- cart signal extraction
- helper открытия корзины
- cart page signature

### Артефакты
- `src/helpers/cart.ts`
- обновления `site-packs/litres/instructions.md`
- обновления `site-packs/litres/hints.json`
- `site-packs/litres/approved/validation-rules.json`
- `examples/demo-litres-cart.ts`

### Done when
- можно пройти flow `search -> product -> add_to_cart -> cart`
- trace показывает подтверждение успеха

---

## Commit 9 — OpenClaw skill integration v1

### Что сделать
Подготовить реальное использование из OpenClaw.

### Нужно сделать
- шаблон workspace skill `browser-platform`
- описать в skill:
  - когда использовать CLI
  - как звать `session open`
  - как работать через `observe/act`
  - как читать `pageSignature` и success signals
  - когда останавливаться
- добавить examples команд для `exec`

### Артефакты
- `src/openclaw/skill-template/SKILL.md`
- `src/openclaw/prompt-context.ts`
- `README.md` секция запуска из OpenClaw

### Done when
- агент может использовать LitRes pilot flow из skill-инструкции, а не только вручную

---

## Commit 10 — Traces v1 + MVP0 acceptance

### Что сделать
Закрыть MVP0 приёмкой.

### Нужно проверить
- trace пишет:
  - step logs
  - screenshots
  - DOM/HTML snapshots
  - page signature guesses
  - success/failure observations
- есть один успешный LitRes pilot run
- есть один неуспешный run, по которому понятно, что сломалось
- `README.md` содержит команды запуска
- текущие ограничения MVP0 описаны явно

### Done when
- можно показать рабочий LitRes pilot
- можно локализовать поломку по trace
- можно вручную поправить pack и перепройти flow

---

## 6. Acceptance checklist

### Техническая приёмка
- [ ] daemon живёт отдельно от одного CLI-вызова
- [ ] session state переживает несколько CLI-команд
- [ ] весь CLI умеет возвращать JSON
- [ ] traces создаются на каждом шаге
- [ ] pack `litres` автоматически матчится по домену

### Функциональная приёмка
- [ ] LitRes home открывается
- [ ] авторизованная сессия подхватывается, если доступна
- [ ] поиск книги работает
- [ ] карточка книги открывается
- [ ] add-to-cart подтверждается
- [ ] корзина открывается

### Инженерная приёмка
- [ ] по trace понятно, где именно упало
- [ ] можно руками исправить `hints.json` / `instructions.md`
- [ ] повторный запуск после правки pack даёт лучший результат

---

## 7. Самое важное ограничение MVP0

Если на LitRes внезапно окажется, что самый сложный кусок — это не browser control, а auth/bootstrap, то **не надо ломать архитектуру ради попытки решить всё внутри browser-platform**.

Правильный ход:
- reuse существующего login bootstrap
- отдельно зафиксировать auth boundary
- продолжать доказывать основную архитектуру на части `search -> product -> cart`

Это важно, чтобы MVP0 не утонул в побочной сложности.

---

## 8. Если хочется ещё сильнее упростить

Самый минимальный MVP0 subset выглядит так:

### MVP0-a
- daemon
- CLI
- `session open`
- `observe`
- `act`
- LitRes pack
- flow: `search -> product`

### MVP0-b
- add-to-cart
- cart validation
- traces v1

Если окажется, что полный MVP0 слишком широкий, можно идти именно так.
