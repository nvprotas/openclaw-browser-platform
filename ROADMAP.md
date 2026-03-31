# openclaw-browser-platform — roadmap

## 0. Новая базовая парадигма

Этот репозиторий строится не вокруг идеи:
- «спрячем браузер за узким API»
- «для каждого сайта напишем полную обвязку»

А вокруг другой модели:

```text
OpenClaw agent
  + Playwright
  + site instructions / site packs
  + shared browser helpers
  + trace memory from previous runs
```

То есть:
- агенту **можно давать Playwright**
- но агент не должен работать в вакууме
- устойчивость достигается не site-specific API на каждый сайт, а комбинацией:
  - **общих helper'ов**
  - **site packs**
  - **инструкций по сайту**
  - **trace/replay/debugging**
  - **human-in-the-loop на рискованных шагах**

Главная идея:  
**не прятать браузер от агента, а дать ему хороший operational framework поверх Playwright.**

---

## 1. Что именно мы строим

Платформу для браузерной автоматизации под OpenClaw, где:
- агент умеет работать с реальным браузером через Playwright
- знания по сайтам хранятся как **site packs**
- общая логика вынесена в **shared helper library**
- предыдущие прохождения сохраняются в **traces**
- критические шаги проходят через **risk rules / human handoff**

Это не «SDK для каждого сайта» и не «магический универсальный агент».  
Это **слой дисциплины и накопления опыта поверх Playwright**.

---

## 2. Почему именно так

### Что не взлетает
Если делать жёсткий API на каждый сайт, получится:
- много ручной обвязки
- высокий порог добавления новых сайтов
- постоянный долг поддержки
- слишком медленное масштабирование

### Что тоже не взлетает
Если дать агенту только raw Playwright без структуры, получится:
- хаос в промптах
- повторяющиеся костыли
- слабая переиспользуемость
- трудно дебажить
- знания не копятся системно

### Что выглядит реалистично
Средний путь:
- Playwright остаётся реальным исполнительным слоем
- общие приёмы жизни в браузере живут в helper library
- per-site знания живут в instructions/packs
- traces помогают улучшать packs и инструкции
- сложные сайты постепенно harden'ятся точечными detectors/recoveries

---

## 3. Основные принципы

1. **Playwright остаётся доступен агенту**  
   Мы не строим анти-Playwright архитектуру.

2. **Не писать полную обвязку на каждый сайт**  
   Site pack должен быть лёгким и эволюционировать постепенно.

3. **Progressive hardening**  
   Новый сайт сначала работает в generic mode, потом получает hints, потом detectors/recoveries, и только в крайнем случае — site-specific код для критичных шагов.

4. **Instructions are first-class**  
   Знания по сайту должны храниться не только в коде, но и в читабельных инструкциях для агента.

5. **Shared helpers важнее раннего over-engineering**  
   Сначала нужен хороший набор общих browser helpers, а не сложная платформенная абстракция.

6. **Trace everything important**  
   Прохождения должны оставлять артефакты: шаги, snapshots, ошибки, recoveries.

7. **Human-in-the-loop на рискованных шагах**  
   Логин, 2FA, CAPTCHA, чувствительные платёжные действия, финальный submit — отдельная зона контроля.

---

## 4. Цели первого этапа

### Основные
- Запустить базовую платформу: Playwright + instructions + site packs + traces.
- Сделать систему, куда легко добавлять новые сайты без написания «SDK сайта».
- Создать shared helpers для типовых действий:
  - поиск
  - добавление в корзину
  - открытие корзины
  - переходы по checkout
  - работа с попапами
  - валидация результата
- Накопить формат знаний по сайтам, который можно постепенно усиливать.

### Не-цели на старте
- Полная автоматизация оплаты без участия человека.
- Самообучение без верификации.
- Идеальная универсальность для любых сайтов с первого дня.
- Сложный orchestration layer ради abstraction purity.

---

## 5. Ментальная модель поддержки сайтов

Не у всех сайтов должен быть одинаковый уровень поддержки.

### Level 0 — generic mode
Есть только:
- домен
- стартовый URL
- минимальная инструкция

Агент работает почти целиком сам через Playwright и общие helpers.

### Level 1 — site profile
Добавляется структурированное описание:
- login hints
- search hints
- add-to-cart patterns
- cart signals
- checkout notes
- common popups
- known risks

### Level 2 — site helpers
Добавляются точечные штуки:
- selectors/hints
- detectors
- recoveries
- validation rules

### Level 3 — hardened critical flows
Для самых важных сайтов и самых хрупких шагов добавляется специальная логика:
- логин
- add-to-cart
- ключевые переходы checkout

Именно так это должно масштабироваться. Не «API на каждый сайт», а **постепенное усиление нужных мест**.

---

## 6. Что такое site pack в этой модели

Site pack — это не обязательно толстый адаптер.  
Это пакет знаний и усилителей для конкретного сайта.

Он может включать:
- `manifest.json`
- `instructions.md`
- `login.md`
- `checkout.md`
- `selectors.json` или `hints.json`
- `detectors.ts`
- `recoveries.ts`
- `notes.md`

### Что там хранится

#### Manifest
- `site_id`
- `domains`
- `start_url`
- `site_type`
- `risk_flags`
- `supported_flows`
- `support_level`

#### Instructions
Человеческое описание для агента:
- как обычно устроен сайт
- где искать поиск
- как выглядит add-to-cart
- как подтверждается успех
- где часто ломается flow
- когда нужно звать человека

#### Hints/selectors
Не обязательно жёсткий код, а подсказки:
- candidate selectors
- button texts
- landmarks
- cart signals
- modal patterns

#### Detectors
Точечная логика:
- определить checkout stage
- определить login gate
- определить, что товар реально добавился
- определить, что открылась корзина

#### Recoveries
- закрыть common modal
- повторно синхронизировать страницу
- открыть cart drawer заново
- переждать rerender
- перейти в fallback path

---

## 7. Shared helper library

Это главный технический слой, который нужен почти сразу.

Он должен содержать не «бизнес-операции сайта X», а общие примитивы и паттерны исполнения.

### Примеры helper'ов
- `navigateAndWait()`
- `waitForStableDom()`
- `closeCommonPopups()`
- `findSearchInput()`
- `fillSearchAndSubmit()`
- `findAddToCartTargets()`
- `clickAndValidate()`
- `detectCartChange()`
- `openCartByCommonPatterns()`
- `detectLoginGate()`
- `captureState()`
- `retryStep()`
- `recordTraceStep()`

### Важный принцип
Helper library не должна пытаться знать каждый сайт.  
Она должна решать типовые browser-проблемы, которые встречаются везде.

---

## 8. Traces и память прохождений

Traces — обязательный слой, потому что именно он превращает разовые прогоны в накопление опыта.

### Что хранить
- session id
- site id
- timestamp
- текущий flow
- шаги
- screenshot refs
- DOM/HTML snapshot refs
- текстовые заметки
- outcome
- какие recovery сработали
- где потребовался handoff

### Зачем это нужно
- дебажить падения
- улучшать instructions
- улучшать selectors/hints
- улучшать detectors/recoveries
- видеть реальные failure patterns

### Что не делать сразу
- не строить сложный ML/RAG-контур как ядро архитектуры
- не делать traces единственным источником знаний

Traces — это материал для улучшения packs и helpers, а не замена им.

---

## 9. Risk model

В новой парадигме мы не скрываем Playwright, но это не значит, что риски игнорируются.

### Шаги, которые требуют особого контроля
- логин с чувствительными данными
- 2FA / OTP
- CAPTCHA
- изменение платёжных реквизитов
- финальный payment submit
- подтверждение заказа с финансовыми последствиями

### Что нужно сделать
- описать risk notes в site packs
- явно помечать handoff points
- сохранять trace перед рискованным шагом
- не пытаться «автоматизировать всё любой ценой»

---

## 10. Предлагаемая структура репозитория

```text
openclaw-browser-platform/
  README.md
  ROADMAP.md
  docs/
    architecture.md
    site-pack-spec.md
    trace-model.md
    safety.md

  src/
    core/
      types/
      errors/
      logging/
      risk/

    playwright/
      browser-session.ts
      controller.ts
      snapshots.ts
      waits.ts
      dom-utils.ts

    helpers/
      navigation.ts
      popups.ts
      search.ts
      cart.ts
      checkout.ts
      login-gates.ts
      validation.ts
      tracing.ts
      retries.ts

    packs/
      loader.ts
      manifest.ts
      instructions.ts
      hints.ts
      detectors.ts
      recoveries.ts

    traces/
      trace-store.ts
      trace-schema.ts
      replay.ts

    runtime/
      run-site-flow.ts
      run-step.ts
      step-context.ts
      flow-result.ts

    integrations/
      openclaw/
        session-bridge.ts
        prompt-context.ts

  site-packs/
    example-shop/
      manifest.json
      instructions.md
      login.md
      checkout.md
      hints.json
      detectors.ts
      recoveries.ts

  examples/
    demo-generic-run.ts
    demo-pack-run.ts

  tests/
    unit/
    integration/
    fixtures/
```

---

## 11. Рабочие сценарии, которые надо поддержать

На первом этапе нужны не «абстрактные capabilities», а реальные пользовательские сценарии.

### Базовые сценарии
1. открыть сайт
2. залогиниться или дойти до login gate
3. найти товар
4. открыть карточку
5. добавить товар в корзину
6. открыть корзину
7. перейти к checkout
8. остановиться перед рискованным шагом или запросить handoff

### Generic-стратегия
Сначала пытаемся пройти flow:
- через общие helpers
- с учётом instructions/hints
- с записью traces

Если сайт оказывается проблемным, усиливаем его pack точечно.

---

## 12. Этапы работ

## M0 — bootstrap

### Что сделать
- Поднять TypeScript-проект.
- Настроить package manager, tsconfig, eslint, prettier, test runner.
- Подключить Playwright.
- Подготовить базовый CI.

### Deliverables
- `package.json`
- `tsconfig.json`
- lint/test config
- Playwright dependency
- CI

### Критерий готовности
- проект ставится и запускается
- можно выполнить минимальный Playwright script

### Оценка
- 0.5–1 день

---

## M1 — raw Playwright runtime, но дисциплинированный

### Что сделать
Сделать минимальный runtime для реальной работы браузера:
- browser session
- page/session lifecycle
- navigate/click/fill/extract/screenshot
- HTML/DOM snapshot
- waits/timeouts
- structured logging

### Deliverables
- `src/playwright/*`
- простой demo script

### Критерий готовности
- можно открыть сайт, найти элементы, кликнуть, снять артефакты

### Оценка
- 1–2 дня

---

## M2 — shared helper library v1

### Что сделать
Сделать первые реально полезные browser helpers:
- navigation helpers
- popup handling
- search helpers
- add-to-cart verification helpers
- cart open helpers
- login gate detection
- generic retry helpers
- trace hooks

### Deliverables
- `src/helpers/*`
- unit tests

### Критерий готовности
- агенту уже можно давать Playwright + helper library + короткую инструкцию

### Оценка
- 2–3 дня

---

## M3 — site pack spec

### Что сделать
Зафиксировать формат site packs.

### Нужно покрыть
- manifest schema
- instructions format
- hints format
- optional detector/recovery hooks
- support levels
- risk flags

### Deliverables
- `docs/site-pack-spec.md`
- `src/packs/manifest.ts`
- `src/packs/loader.ts`

### Критерий готовности
- можно положить новый pack в `site-packs/` и загрузить его по домену

### Оценка
- 1 день

---

## M4 — instructions pipeline

### Что сделать
Сделать слой, который подмешивает в запуск site instructions:
- общие runtime conventions
- site-specific instructions
- hints/selectors
- risk notes
- last successful patterns from traces

### Deliverables
- `src/packs/instructions.ts`
- `src/integrations/openclaw/prompt-context.ts`

### Критерий готовности
- агент получает не пустой browser session, а контекст по сайту и общие правила выполнения

### Оценка
- 1–2 дня

---

## M5 — traces v1

### Что сделать
Сделать trace storage и replay-friendly артефакты.

### Deliverables
- `src/traces/trace-store.ts`
- `src/traces/trace-schema.ts`
- `docs/trace-model.md`

### Критерий готовности
- после запуска можно посмотреть, что происходило пошагово
- понятно, как использовать traces для улучшения site pack

### Оценка
- 1–2 дня

---

## M6 — site pack example

### Что сделать
Сделать один полноценный demo pack.

### Что должно быть внутри
- manifest
- instructions
- hints
- минимум один detector
- минимум один recovery
- demo flow

### Критерий готовности
- демонстрация generic mode vs pack-assisted mode на одном сайте

### Оценка
- 2 дня

---

## M7 — progressive hardening layer

### Что сделать
Добавить механику усиления сайтов без переписывания всего flow.

### Что именно
- support levels
- optional pack hooks
- fallback chains
- success validators
- site-specific recoveries

### Критерий готовности
- можно усиливать один проблемный участок, не превращая весь сайт в огромный адаптер

### Оценка
- 1–2 дня

---

## M8 — OpenClaw integration

### Что сделать
Сделать интеграционный слой под OpenClaw.

### Что важно
Не строить жёсткий site API.  
Нужно уметь запускать browser session с правильным контекстом:
- Playwright access
- helper library
- site instructions
- current pack
- traces summary

### Deliverables
- `src/integrations/openclaw/session-bridge.ts`
- `src/integrations/openclaw/prompt-context.ts`

### Критерий готовности
- OpenClaw может запускать браузерные задачи с нужным operational context

### Оценка
- 1 день

---

## M9 — safety/handoff layer

### Что сделать
Описать и реализовать handoff точки.

### Что покрыть
- login notes
- OTP/2FA/CAPTCHA
- payment gates
- final confirmation
- trace before handoff
- resume after handoff

### Критерий готовности
- рискованные моменты не теряются и не выполняются «мимоходом»

### Оценка
- 1 день

---

## M10 — docs and release baseline

### Что сделать
- обновить README
- добавить quickstart
- добавить how-to for new site pack
- добавить примеры generic run и pack-assisted run
- собрать `v0.1.0`

### Критерий готовности
- новый разработчик понимает, как добавить сайт и как усилить его постепенно

### Оценка
- 1 день

---

## 13. Порядок реализации

Рекомендуемый порядок:

1. M0 bootstrap
2. M1 Playwright runtime
3. M2 shared helpers
4. M3 site pack spec
5. M4 instructions pipeline
6. M5 traces
7. M6 example pack
8. M7 progressive hardening
9. M8 OpenClaw integration
10. M9 safety/handoff
11. M10 docs/release

Причина простая:
- сначала нужен живой Playwright runtime
- потом helpers
- потом packs/instructions
- и только потом более сложные усиления

---

## 14. v0.1 scope

Чтобы не утонуть, в `v0.1` надо сделать только это.

### Обязательно
- Playwright runtime
- shared helpers v1
- site pack format
- instructions injection
- traces v1
- один demo site pack
- handoff points для рискованных шагов

### Не обязательно
- универсальный checkout engine
- автоматическое обучение packs
- полноценный RAG по traces
- богатая capability taxonomy
- много сайтов сразу

---

## 15. Минимальный backlog по коммитам

### Commit 1
Bootstrap:
- package.json
- tsconfig
- eslint/prettier
- test runner
- Playwright

### Commit 2
Playwright runtime:
- browser session
- controller
- waits
- snapshots

### Commit 3
Shared helpers v1:
- navigation
- popups
- search
- cart helpers
- validation

### Commit 4
Site pack spec:
- manifest schema
- instructions format
- loader
- example manifest

### Commit 5
Trace layer:
- trace schema
- trace store
- step logging

### Commit 6
Example pack:
- instructions.md
- hints.json
- detector
- recovery
- demo flow

### Commit 7
OpenClaw bridge:
- prompt context builder
- session bridge
- handoff handling

---

## 16. Что делать прямо сейчас

Самый практичный следующий шаг:

1. поднять TypeScript + Playwright
2. сделать минимальный browser runtime
3. написать первые shared helpers
4. зафиксировать site pack spec
5. сделать один example pack

Это даст живую, реалистичную основу под модель:

**Playwright + instructions + site packs + traces**

А уже потом можно смотреть, где реально нужны более жёсткие abstractions.
