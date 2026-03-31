# openclaw-browser-platform — roadmap

## 0. Базовая парадигма

Этот проект строится вокруг следующей модели:

```text
OpenClaw agent
  + Playwright
  + shared browser helpers
  + site packs / site instructions
  + traces from previous runs
  + human handoff via VNC when needed
  + knowledge authoring / learning loop
```

То есть:
- агенту **можно и нужно** давать Playwright
- мы **не** хотим писать полный API/SDK для каждого сайта
- устойчивость достигается не абстракцией «спрятать браузер», а комбинацией:
  - общих helper'ов
  - site packs
  - инструкций по сайту
  - traces и replay
  - демонстраций человека через VNC
  - постепенного накопления знаний

Главная идея:

**Не ограничивать агента узким API, а дать ему Playwright + дисциплину + память + наращиваемые знания по сайтам.**

---

## 1. Что мы строим

Платформу браузерной автоматизации под OpenClaw, где:
- агент выполняет действия через Playwright
- site-specific знания хранятся в `site-packs/`
- типовые browser-паттерны живут в shared helper library
- застревание можно передать человеку через VNC
- действия человека во время handoff используются как материал для обучения
- OpenClaw умеет записывать новые знания:
  - какие кнопки нажимать
  - в каком порядке идти
  - какие сигналы считать успешными
  - какие recoveries работают

Это не «полная универсальная магия» и не «обвязка под каждый магазин вручную».  
Это **эволюционирующая knowledge-driven система поверх Playwright**.

---

## 2. Что не взлетает и чего мы избегаем

### Не хотим
- full site-specific API для каждого сайта
- толстые hardcoded adapters с первого дня
- знания, спрятанные только в промптах
- знания, спрятанные только в логах
- обучение на основании однократного случайного удачного клика
- запоминание только координат клика без понимания контекста

### Хотим
- generic mode для новых сайтов
- progressive hardening для важных сайтов
- site packs как lightweight-слой знаний
- human-assisted learning loop
- candidate → validated → approved knowledge pipeline

---

## 3. Основные принципы

1. **Playwright — основной исполнительный слой**  
   Мы не боремся с ним, а используем его как реальный browser runtime.

2. **Не писать «обвязку на всё»**  
   Site pack должен быть маленьким и усиливаться постепенно.

3. **Progressive hardening**  
   Сайт сначала живёт в generic mode, потом получает hints, затем detectors/recoveries, и только при необходимости — site-specific hardened flows.

4. **Instructions are first-class**  
   Знания по сайту должны храниться не только в коде, но и в понятных инструкциях для агента.

5. **Shared helpers важнее ранней гиперабстракции**  
   Сначала делаем хороший operational toolkit поверх Playwright.

6. **Человек через VNC — не только аварийный режим, но и источник обучения**  
   Handoff должен превращаться в usable knowledge.

7. **OpenClaw должен уметь записывать новые знания**  
   Но новые знания не должны сразу автоматически становиться каноном.

8. **Запоминаем не “куда кликнули”, а “что сделали и почему это сработало”**  
   Координаты — только вспомогательный сигнал, а не основное знание.

9. **Рискованные шаги требуют отдельного контроля**  
   Логин, OTP, CAPTCHA, финальный submit платежа и заказа — особая зона.

---

## 4. Модель поддержки сайтов

Не все сайты должны поддерживаться одинаково.

### Level 0 — Generic
Есть только:
- домен
- стартовый URL
- краткая инструкция

Агент в основном опирается на Playwright + shared helpers.

### Level 1 — Profiled
Есть:
- `instructions.md`
- `hints.json`
- known page types
- common popups
- cart signals
- risk notes

### Level 2 — Assisted
Добавляются:
- detectors
- recoveries
- validation rules
- learned candidate flows

### Level 3 — Hardened
Добавляется точечная специальная логика для хрупких мест:
- login flow
- add-to-cart
- checkout transitions
- особо нестабильные UI места

Это и есть масштабируемая модель. Не «пишем SDK на каждый сайт», а **усиливаем только то, что реально нужно**.

---

## 5. Основные слои системы

## 5.1 Playwright runtime

Что должен уметь runtime:
- открывать browser/session/context
- navigate/click/fill/type/press
- читать DOM/HTML
- делать screenshots
- писать structured trace events
- поддерживать pause/handoff/resume

## 5.2 Shared browser helpers

Это общий operational toolkit:
- `navigateAndWait()`
- `waitForStableDom()`
- `closeCommonPopups()`
- `findSearchInput()`
- `fillSearchAndSubmit()`
- `findAddToCartCandidates()`
- `clickAndValidate()`
- `detectCartChange()`
- `openCartByCommonPatterns()`
- `detectLoginGate()`
- `captureState()`
- `retryStep()`
- `recordTraceStep()`

Именно helpers должны покрывать типовые browser-проблемы, а не тащить в себя всю site-specific логику.

## 5.3 Site packs

Site pack — это пакет знаний и усилителей по сайту.

Он может включать:
- `manifest.json`
- `instructions.md`
- `login.md`
- `checkout.md`
- `hints.json`
- `detectors.ts`
- `recoveries.ts`
- `learned/`
- `approved/`

## 5.4 Traces

Traces — это основа дебага и обучения.

Нужно хранить:
- session id
- site id
- timestamps
- шаги
- screenshots
- DOM/HTML snapshots
- заметки агента
- успех/ошибка
- сработавшие recoveries
- точки handoff/resume

## 5.5 Human handoff via VNC

Когда агент застрял:
- он запрашивает помощь человека
- система открывает/использует VNC handoff mode
- система пишет demonstration trace
- после возврата агент и/или post-processing слой пытаются превратить демонстрацию в знание

## 5.6 Knowledge authoring

OpenClaw должен уметь:
- создавать новые инструкции
- добавлять hints
- сохранять candidate selectors
- сохранять candidate flow order
- сохранять success signals
- сохранять recovery notes
- помечать источник знаний и confidence

---

## 6. Как именно должен работать VNC handoff learning

Это отдельный обязательный контур архитектуры.

### Когда нужен handoff
- агент не понимает, что делать дальше
- generic flow сломался
- на сайте появилась новая модалка/новый UI
- нужен человек для логина, OTP, CAPTCHA, payment confirmation
- агент хочет показать человеку текущее состояние и попросить провести несколько шагов вручную

### Что система должна записывать во время VNC handoff

На каждом важном шаге:
- URL
- screenshot до действия
- screenshot после действия
- DOM snapshot до/после
- координаты клика/drag/type как сырой сигнал
- элемент под кликом, если его удалось сопоставить
- текст кнопки
- role / aria-label / title / visible text
- nearby labels и контекст
- тип действия: click / type / select / press / wait
- порядок шагов
- какое изменение произошло после действия

### Что мы НЕ должны считать знанием по умолчанию
- голые координаты клика
- точный nth-child путь
- случайный dynamic id
- одноразовый локальный state

### Что мы ХОТИМ извлекать из handoff
- какой semantic action сделал человек
- по какому элементу он кликнул
- как этот элемент можно найти в будущем
- в каком порядке человек прошёл шаги
- какой сигнал говорит, что шаг успешен
- какой recovery использовал человек

### Результат VNC handoff
Не «человек кликнул в x=842, y=611», а:
- `action_intent: add_to_cart`
- `page_signature: product_page`
- `target_text: "В корзину"`
- `selector_candidates: [...]`
- `success_signal: cart_badge_increment`
- `source: human_demo`
- `confidence: low|medium|high`

---

## 7. Как OpenClaw должен добавлять новые знания

OpenClaw должен уметь не только пользоваться знаниями, но и пополнять их.

### Какие знания он должен уметь добавлять
- новые site instructions
- новые hints/selectors
- распознанные кнопки и тексты
- candidate step order
- page signatures
- success signals
- failure patterns
- recovery steps

### Но есть важное ограничение
OpenClaw **не должен** в ранних MVP бездумно переписывать approved code/knowledge.

Нужен pipeline:

```text
raw trace / human demo
    ↓
candidate knowledge
    ↓
validation / replay / repeated success
    ↓
approved knowledge
```

### Типы источников знания
Каждый knowledge object должен хранить:
- `source: human_demo | agent_success | manual_authoring | imported`
- `confidence`
- `created_at`
- `last_verified_at`
- `verification_count`
- `site_id`
- `page_signature`

### Где OpenClaw может писать безопасно
В ранних инкрементах — в:
- `learned/candidate-flows.json`
- `learned/candidate-selectors.json`
- `learned/candidate-signals.json`
- `learned/notes.md`

А не сразу в:
- `approved/hints.json`
- `detectors.ts`
- `recoveries.ts`

---

## 8. Модель знаний

Явно разделяем четыре слоя знаний.

## 8.1 Raw runtime artifacts
Сырые данные:
- traces
- screenshots
- DOM snapshots
- raw VNC events
- chat notes

## 8.2 Candidate knowledge
Черновики, извлечённые из trace или human demo:
- candidate selectors
- candidate button text
- candidate flows
- candidate success signals
- candidate recoveries

## 8.3 Validated knowledge
Кандидаты, которые уже были подтверждены повторным успешным прохождением.

## 8.4 Approved pack knowledge
То, что уже считается рабочей частью site pack:
- approved instructions
- approved hints
- approved detectors/recoveries
- approved flow notes

---

## 9. Предлагаемая структура репозитория

```text
openclaw-browser-platform/
  README.md
  ROADMAP.md

  docs/
    architecture.md
    site-pack-spec.md
    trace-model.md
    demo-learning.md
    safety.md
    mvp-plan.md

  src/
    core/
      types/
      errors/
      logging/
      risk/
      knowledge/

    playwright/
      browser-session.ts
      controller.ts
      waits.ts
      snapshots.ts
      dom-utils.ts
      event-capture.ts

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
      semantic-actions.ts

    packs/
      loader.ts
      manifest.ts
      instructions.ts
      hints.ts
      support-levels.ts
      candidate-knowledge.ts
      approved-knowledge.ts

    traces/
      trace-store.ts
      trace-schema.ts
      replay.ts
      artifact-index.ts

    demos/
      vnc-capture.ts
      action-extractor.ts
      dom-alignment.ts
      candidate-generator.ts
      replay-candidate.ts

    runtime/
      run-site-flow.ts
      run-step.ts
      handoff.ts
      resume.ts
      flow-result.ts

    integrations/
      openclaw/
        session-bridge.ts
        prompt-context.ts
        knowledge-writes.ts
        handoff-events.ts

  site-packs/
    example-shop/
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
      detectors.ts
      recoveries.ts

  traces/
    raw/
    demos/
    replay/

  examples/
    demo-generic-run.ts
    demo-pack-run.ts
    demo-vnc-handoff.ts

  tests/
    unit/
    integration/
    fixtures/
```

---

## 10. Product increments — что будет в MVP0, MVP1, MVP2 и дальше

Это главный раздел.  
Ниже описано, что именно считается полезным продуктовым инкрементом.

---

## MVP0 — usable manual foundation

### Цель
Сделать минимально полезную систему, где агент уже может работать через Playwright, используя helpers и site instructions, но без сложного обучения.

### Что войдёт
- TypeScript + Playwright foundation
- browser runtime:
  - session/context/page lifecycle
  - click/fill/type/navigate/extract/screenshot
- shared helpers v1:
  - navigation
  - popups
  - search helpers
  - cart helpers
  - validation helpers
  - retry helpers
- базовый формат site pack:
  - `manifest.json`
  - `instructions.md`
  - `hints.json`
- загрузка pack по домену
- instructions injection в запуск
- traces v1:
  - step logs
  - screenshots
  - DOM/HTML snapshots
- один example site pack
- базовые handoff markers:
  - агент может сказать «нужна помощь человека»
  - trace фиксирует точку остановки

### Что НЕ войдёт
- автоматическое извлечение знаний из VNC
- автоматическое обновление approved pack knowledge
- полноценный validation pipeline
- автопромоут candidate knowledge

### Критерий готовности
- агент может пройти базовый flow на простом сайте с pack-assisted mode
- можно отследить, где именно flow сломался
- можно вручную дописать/исправить pack

---

## MVP1 — handoff-aware system

### Цель
Добавить полноценный человеческий handoff и сбор демонстраций как артефактов для последующего обучения.

### Что войдёт
- VNC handoff lifecycle:
  - pause
  - human takes over
  - resume
- demonstration capture:
  - screenshots до/после
  - DOM snapshots до/после
  - raw user actions
  - timestamps
- сохранение demo artifacts в `traces/demos/`
- начальный extractor, который пытается определить:
  - по какому элементу человек кликнул
  - какой был текст/роль элемента
  - какой step order прошёл человек
- candidate knowledge format:
  - candidate selectors
  - candidate flow steps
  - candidate success signals
- OpenClaw knowledge writes v1:
  - запись новых черновых знаний в `learned/`
  - запись `source`, `confidence`, `verification_count`
- базовый replay одного candidate step для проверки гипотезы

### Что НЕ войдёт
- полностью автоматическая промоция в approved
- автоматическая генерация detectors.ts
- сложное обучение на многошаговых демо без валидации

### Критерий готовности
- человек может помочь через VNC
- после handoff система сохраняет пригодные для анализа demonstration artifacts
- OpenClaw умеет создать candidate knowledge из демонстрации

---

## MVP2 — learning from demonstrations

### Цель
Сделать так, чтобы помощь человека реально улучшала последующие прохождения.

### Что войдёт
- action extraction v2:
  - сопоставление raw click с DOM element candidate
  - semantic action inference
  - page signature extraction
- flow candidate generator:
  - sequence of steps
  - page transitions
  - success signals
  - fallback hints
- verification pipeline:
  - повторный replay candidate knowledge
  - verification count
  - confidence updates
- validated knowledge layer
- простая промоция:
  - confirmed selectors → approved hints
  - confirmed flow notes → approved flow notes
- support for mixed sources:
  - `human_demo`
  - `agent_success`
  - `manual_authoring`

### Что НЕ войдёт
- полностью автономное обучение без ограничений
- массовая автоматическая генерация hardcoded flows
- переписывание detectors/recoveries без review rules

### Критерий готовности
- после 1–2 демонстраций агент реально лучше проходит похожий flow
- новые знания можно отследить и объяснить

---

## MVP3 — self-improving site packs

### Цель
Сделать так, чтобы OpenClaw мог системно наращивать знания по сайтам, а не просто копить traces.

### Что войдёт
- OpenClaw knowledge authoring v2:
  - обновление instructions draft
  - обновление candidate hints
  - добавление новых flow notes
  - добавление recovery notes
- approval rules
- candidate vs approved diffing
- trace-driven suggestions:
  - «этот selector устарел»
  - «эта кнопка стабильно работает лучше»
  - «этот recovery часто спасает flow»
- progressive hardening controls:
  - support level upgrades
  - feature flags per site
- resume after human handoff с учётом новых знаний

### Что НЕ войдёт
- полное отсутствие human review для sensitive knowledge
- автоматическая бесконтрольная модификация production packs

### Критерий готовности
- система может наращивать site pack без тотального ручного переписывания
- знания живут в понятной структуре, а не в истории чатов

---

## MVP4 — production hardening

### Цель
Довести систему до состояния, где она может устойчиво обслуживать несколько важных сайтов и долго жить.

### Что войдёт
- несколько реальных site packs
- стабильный handoff/resume lifecycle
- проверка backwards compatibility pack changes
- artifact browser / trace inspection UX
- улучшенные recoveries
- более строгий risk layer
- policy around payment/OTP/CAPTCHA

### Критерий готовности
- можно поддерживать несколько сайтов без ощущения, что всё держится на случайности

---

## 11. Engineering milestones

Ниже — инженерные шаги, как дойти до MVP'шек.

### M0 — Bootstrap
- package manager
- tsconfig
- lint/test setup
- Playwright setup
- базовый CI

### M1 — Playwright runtime
- session/context/page lifecycle
- navigation/click/fill/extract
- screenshots/snapshots
- structured logging

### M2 — Shared helpers
- popups
- search
- cart
- validation
- retries
- trace hooks

### M3 — Site pack spec
- manifest
- instructions
- hints
- support levels
- pack loader

### M4 — Traces v1
- trace schema
- artifact layout
- replay basics

### M5 — Handoff v1
- pause/resume
- VNC event capture
- demo artifacts

### M6 — Candidate knowledge pipeline
- candidate formats
- action extraction
- knowledge writes to `learned/`

### M7 — Validation pipeline
- replay candidates
- confidence updates
- approved vs candidate split

### M8 — Progressive hardening
- support level upgrade path
- detector/recovery injection
- site-specific strengthenings

### M9 — Release hardening
- docs
- examples
- testing matrix
- release baseline

---

## 12. MVP mapping to milestones

Чтобы не потеряться в терминах:

- **MVP0** ≈ M0 + M1 + M2 + M3 + M4
- **MVP1** ≈ MVP0 + M5 + часть M6
- **MVP2** ≈ MVP1 + M6 + M7
- **MVP3** ≈ MVP2 + M8
- **MVP4** ≈ MVP3 + M9

---

## 13. Что делать прямо сейчас

Если двигаться прагматично, следующий реальный порядок такой:

1. поднять TypeScript + Playwright
2. сделать runtime
3. сделать helper library v1
4. зафиксировать site pack spec
5. сделать traces v1
6. сделать один example site pack
7. после этого добавлять handoff/demos/learning

Почему именно так:
- без живого runtime нечего учить
- без helpers агент будет тонуть в raw DOM-хаосе
- без traces нечем будет питать learning loop
- без pack format знаниям некуда складываться

---

## 14. Первый backlog на ближайшие коммиты

### Commit 1
Bootstrap:
- package.json
- tsconfig
- eslint/prettier
- vitest/jest
- Playwright

### Commit 2
Runtime:
- browser-session
- controller
- waits
- snapshots

### Commit 3
Helpers:
- navigation
- popups
- search
- cart
- validation
- tracing helpers

### Commit 4
Pack spec:
- manifest
- instructions
- hints
- loader
- example pack skeleton

### Commit 5
Traces:
- trace schema
- artifact layout
- replay basics

### Commit 6
Example pack:
- instructions.md
- hints.json
- demo flow

### Commit 7
Handoff foundation:
- pause/resume
- handoff events
- demo artifact capture skeleton

### Commit 8
Candidate knowledge:
- learned/ format
- knowledge write pipeline
- source/confidence metadata

---

## 15. Самый важный итог

Архитектура проекта должна опираться на формулу:

**Playwright + helpers + site packs + traces + human demos + knowledge authoring**

А не на:
- «сырой браузер и хаос»
- «узкий API на каждый сайт»
- «память только в логах»

Если это выдержать, то система сможет:
- быстро стартовать на новых сайтах
- усиливаться на важных сайтах
- учиться у человека через VNC
- пополнять знания силами самого OpenClaw
- не превращаться в кладбище одноразовых скриптов
