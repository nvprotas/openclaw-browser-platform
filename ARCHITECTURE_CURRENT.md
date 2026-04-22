# Current architecture — openclaw-browser-platform

Текущее состояние решения на этапе совместимого CLI/daemon contract для итеративных и сценарных browser flows.

## 1. Главная идея

На старте система строится **без native OpenClaw plugin**.

Вместо этого используется связка:

```text
OpenClaw agent
  -> workspace skill / instructions
  -> exec
  -> browser-platform CLI
  -> browser-platform daemon
  -> Playwright browser runtime
  -> target site (LitRes)
```

Это даёт:

- быстрый старт без plugin SDK
- stateful browser sessions
- понятный CLI contract
- отдельный runtime, который можно тестировать вне OpenClaw

---

## 2. Текущая компонентная схема

```text
┌──────────────────────┐
│   OpenClaw agent     │
│  (planner / chat)    │
└──────────┬───────────┘
           │ uses
           ▼
┌──────────────────────┐
│ workspace skill      │
│ browser-platform     │
│ instructions         │
└──────────┬───────────┘
           │ calls via exec
           ▼
┌──────────────────────┐
│ browser-platform CLI │
│ - daemon ensure      │
│ - session open       │
│ - run-scenario       │
│ - observe            │
│ - snapshot           │
│ - act                │
└──────────┬───────────┘
           │ JSON / localhost bridge
           ▼
┌──────────────────────────────┐
│ browser-platform daemon      │
│ - session registry           │
│ - pack context attachment    │
│ - run-scenario endpoint      │
│ - runtime orchestration      │
└──────────┬───────────────────┘
           │ owns state
           ▼
┌──────────────────────────────┐
│ Playwright runtime           │
│ - browser / context / page   │
│ - observe / snapshot         │
│ - act (navigate/click/...)   │
└──────────┬───────────────────┘
           │ operates on
           ▼
┌──────────────────────────────┐
│ litres.ru                    │
│ - home                       │
│ - search                     │
│ - product                    │
│ - cart                       │
│ - checkout / SberPay boundary │
└──────────────────────────────┘
```

---

## 3. Данные и knowledge layer

```text
repo/
  src/
  site-packs/
    litres/
      manifest.json
      instructions.md
      login.md
      checkout.md
      hints.json
      learned/
      approved/
```

### Роли слоёв

#### `src/`

Код runtime:

- daemon
- CLI
- Playwright runtime
- action layer
- pack loading

#### `site-packs/litres/`

Site-specific knowledge:

- какие домены матчить
- какие flow поддерживаются
- какие риски есть
- какие hints/selectors/signals известны
- какие инструкции давать агенту

#### `learned/`

Черновые знания, извлечённые позже из traces/demos.

#### `approved/`

Подтверждённые знания, которыми можно пользоваться более уверенно.

---

## 4. Что уже работает

### 4.1 Runtime

- daemon живёт отдельно от одного CLI-вызова
- sessions сохраняются между вызовами CLI
- `session open`
- `session context`
- `session observe`
- `session snapshot`
- `session act`
- `session run-scenario`
- daemon endpoint `POST /v1/session/run-scenario`
- optional `nextRecommendedAction` в ответах `observe` / `act`

### 4.2 Action layer

Поддержаны действия:

- `navigate`
- `click`
- `fill`
- `type`
- `press`
- `wait_for`

### 4.3 LitRes pack loading

- домены `litres.ru` и `www.litres.ru` матчятся
- при `session open` в сессию добавляется `packContext`
- `session context` возвращает pack summary

### 4.4 Реально подтвержденный flow

- LitRes home открывается
- поиск `1984` работает
- результаты поиска открываются
- для LitRes checkout/SberPay задач публичный контракт теперь выделен в отдельный сценарий `checkout-to-orderid`

---

## 5. LitRes auth ownership now

Теперь LitRes bootstrap/login path **принадлежит самому `browser-platform`**.

### A. `browser-platform`

Основной daemon/runtime для LitRes flow.

### B. Repo-owned LitRes bootstrap

Встроенный Playwright-based bootstrap живёт в `src/daemon/litres-auth.ts` и запускается из normal `session open` flow.

Внешний workspace skill больше не является runtime-зависимостью для открытия LitRes session.

При этом по умолчанию всё ещё переиспользуются те же практические артефакты:

- `/root/.openclaw/workspace/sber-cookies.json`
- `/root/.openclaw/workspace/tmp/sberid-login/litres/storage-state.json`

---

## 6. Как сейчас выбирать LitRes flow

Для LitRes checkout, order-id extraction и задач “дойти до SberPay/payment boundary” используйте сценарный контракт:

```bash
browser-platform session run-scenario \
  --pack litres \
  --flow checkout-to-orderid \
  --query <text> \
  --profile litres \
  --max-duration-ms 60000 \
  --json
```

CLI вызывает daemon через совместимый endpoint:

```text
POST /v1/session/run-scenario
```

В v1 сценарий сам открывает browser session на указанном `--profile`, выполняет поддержанный pack flow и останавливается на checkout/SberPay boundary. Он не нажимает финальное `Оплатить` и не подтверждает банковский платеж.

Для произвольных задач, отладки и неподдержанных flows остаётся ручной цикл:

```text
session open(...)
  -> observe
  -> act(...)
  -> observe
  -> repeat
```

Ответы `observe` и `act` могут содержать optional `nextRecommendedAction`. Это подсказка для агента, а не обязательное поле JSON-контракта. Старые клиенты продолжают работать, игнорируя это поле.

Ожидаемые значения подсказки:

```text
observe_now
skip_observe
wait_for_hardstop
run_scenario_recommended
```

Если `nextRecommendedAction = "run_scenario_recommended"` появляется в LitRes checkout-контексте, agent/skill должен предпочесть `session run-scenario` вместо дальнейшего ручного кликанья. Для остальных задач решение всё равно принимается по последнему `observe` / `act` результату и safety rules.

---

## 7. Совместимый контракт сценария

Новый сценарный API добавлен отдельно от существующих endpoints:

```text
POST /v1/session/run-scenario
```

Это сохраняет старый observe/act contract:

- существующие `session open`, `context`, `observe`, `act`, `snapshot`, `close` не меняют обязательную форму ответа
- новые поля добавляются только как optional
- `nextRecommendedAction` не является обязательным для клиентов
- `hardStop.finalPayload` остаётся машинным контрактом для возврата payment JSON без изменений

Сценарий LitRes checkout использует тот же профильный storage model:

```text
--profile litres
  -> persistent storage-state
  -> fresh scenario session
  -> checkout-to-orderid flow
  -> hardStop.finalPayload на gateway boundary
```

### Важно

Это **не обязательно** означает полную реализацию Sber ID внутри browser-platform с нуля.

Практичный результат сейчас такой:

- repo сам владеет bootstrap-логикой
- используется тот же стабильный login entrypoint (`https://www.litres.ru/auth/login/`)
- по умолчанию переиспользуется существующий LitRes storage-state path
- cookies/state assets из workspace остаются совместимыми и используются как default inputs
- LitRes checkout/SberPay автоматизация вызывается через `session run-scenario`

То есть целевая архитектура уже стала такой:

- основной LitRes flow живёт внутри browser-platform
- login воспринимается как часть этого flow
- внешний workspace skill больше не обязателен для runtime bootstrap
- OpenClaw skill выбирает `run-scenario` для поддержанного checkout flow и observe→act loop для произвольных задач

---

## 8. Короткий вывод

Текущая архитектура уже рабочая как:

- stateful browser automation runtime
- LitRes-aware pack-assisted system
- основа для дальнейшего auth integration
- совместимый scenario API для LitRes checkout-to-orderid

Главное правило использования:

**для LitRes checkout/SberPay задач использовать `session run-scenario`, для произвольных задач оставлять observe→act loop.**
