# Current architecture — openclaw-browser-platform

Текущее состояние решения на этапе после Commit 5.

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

---

## 5. Где сейчас главный разрыв

Сейчас есть **две почти независимые части**:

### A. `litres-sberid-login`
Отдельный login/bootstrap flow.

### B. `browser-platform`
Основной daemon/runtime для LitRes flow.

Проблема в том, что **auth context между ними пока не склеен**.

То есть сейчас:
- login skill может довести процесс до Sber ID / обновить storage state
- но `browser-platform session open` пока не подхватывает этот auth state автоматически как часть обычного LitRes flow

---

## 6. Как сейчас выглядит LitRes flow

```text
session open(litres home)
  -> observe
  -> act(fill search)
  -> act(press Enter)
  -> observe(search results)
```

И отдельно, снаружи этого flow:

```text
litres-sberid-login script
  -> Sber redirect / state update
```

Именно это и нужно исправить на следующем шаге.

---

## 7. Цель следующего шага (Commit 6)

Следующий архитектурный переход:

```text
login becomes part of the normal LitRes flow
```

То есть login должен быть не внешним ручным pre-step, а встроенной возможностью browser-platform для LitRes.

### Желаемая схема после Commit 6

```text
session open(litres)
  -> detect auth state
  -> if auth missing and login needed:
       run integrated LitRes login/bootstrap path
       reuse resulting state in same runtime
  -> continue with search/product/cart flow
```

### Важно
Это **не обязательно** означает полную реализацию Sber ID внутри browser-platform с нуля.

Достаточно, если browser-platform:
- умеет сам инициировать нужный login/bootstrap step
- умеет подхватить storage state
- воспринимает login как часть flow, а не как внешний ручной ритуал

---

## 8. Короткий вывод

Текущая архитектура уже рабочая как:
- stateful browser automation runtime
- LitRes-aware pack-assisted system
- основа для дальнейшего auth integration

Главный следующий шаг:

**склеить login/bootstrap и основной LitRes runtime в один нормальный flow.**
