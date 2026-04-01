# openclaw-browser-platform — roadmap

## 0. Итоговая стартовая парадигма

На первом этапе проект **не** интегрируется в OpenClaw как native plugin.

Стартовая схема такая:

```text
OpenClaw agent
  -> workspace skill
  -> exec
  -> browser-platform CLI
  -> browser-platform daemon
  -> Playwright
```

А рядом с этим живут:

```text
workspace/browser/
  site-packs/
  traces/
  demos/
  knowledge/
```

То есть:
- агенту по-прежнему даётся управление браузером
- но не через plugin SDK
- и не через хаотичные shell-скрипты
- а через **стабильный CLI bridge** к нашему собственному stateful runtime

Главная идея:

**не писать site-specific API на каждый сайт и не лезть сразу в plugin SDK; сначала сделать работающий daemon + CLI + skill + site packs + learning loop.**

---

## 1. Почему именно так

### Почему не plugin сразу
Потому что это замедляет старт:
- нужно лезть в OpenClaw plugin/runtime wiring
- сложнее быстро дебажить отдельно от агента
- сложнее менять внутренний контракт на раннем этапе

### Почему не просто raw scripts
Потому что это быстро превращается в хаос:
- много разных entrypoint'ов
- нестабильные аргументы
- разный формат ответа
- агенту трудно это надёжно использовать

### Почему нужен CLI
CLI решает одну простую, но важную проблему:

**он даёт OpenClaw стабильный способ общаться с browser-platform.**

CLI — это контракт:
- какие команды вызывать
- какие аргументы передавать
- какой JSON ждать в ответ

### Почему нужен daemon
Потому что браузер и сессия — stateful.

Если не будет daemon, то при каждом вызове придётся:
- заново поднимать браузер
- терять page/session state
- терять handoff state
- усложнять traces и resume

Daemon держит живое состояние:
- browser process
- contexts/pages
- session ids
- current page state
- handoff state
- pending candidate knowledge

### Почему skill всё равно нужен
Потому что OpenClaw должен понимать:
- **когда** использовать browser-platform
- **как** вызывать CLI
- **в каком порядке** действовать
- **когда** звать человека
- **как** сохранять новые знания

Skill — это инструкция для модели.  
CLI/daemon — это runtime.

---

## 2. Что именно мы строим

Платформу браузерной автоматизации под OpenClaw, где:
- агент выполняет браузерные действия через Playwright
- OpenClaw общается с платформой через CLI
- daemon держит живую browser session
- site-specific знания хранятся в site packs
- traces и demos становятся источником обучения
- человек может помочь через VNC
- OpenClaw умеет записывать новые знания в candidate layer

Это не:
- universal magical browser AI
- SDK на каждый сайт
- набор одноразовых playwright-скриптов

Это:

**knowledge-driven browser runtime для OpenClaw с постепенным усилением по сайтам.**

## 2.1 Pilot site: LitRes

Стартовая проверка архитектуры делается не на абстрактном “example-shop”, а на **реальном сайте LitRes**.

Почему именно LitRes:
- уже есть существующий контекст вокруг `litres.ru`
- для LitRes важны реальные состояния: логин, поиск, карточка книги, корзина, checkout entry
- сайт достаточно живой, чтобы быстро показать, где нужны shared helpers, а где нужны site-specific hints/recoveries
- можно валидировать не теорию, а реальный пользовательский сценарий

### Что считаем пилотным LitRes flow
1. восстановить авторизованную сессию
2. найти книгу по запросу
3. открыть карточку книги
4. добавить книгу в корзину
5. открыть корзину
6. дойти до checkout entry
7. если появляется SberPay URL / deeplink / payment form boundary — извлечь payment intent identifiers (`orderId`, `bankInvoiceId`, `mdOrder`, `formUrl` и связанные поля)
8. остановиться перед финальным рискованным шагом

### Что важно для первого этапа
Для LitRes на старте не нужно изобретать auth с нуля.  
Наоборот, MVP должен уметь **переиспользовать уже существующее авторизованное состояние / существующий login bootstrap**, а не пытаться сразу решить весь Sber ID flow внутри browser-platform.

То есть LitRes нужен нам как:
- первый реальный site pack
- первый реальный trace source
- первый реальный handoff/demo source
- база для выделения первых shared helpers

## 2.2 Следующий этап после MVP0: MVP1 VNC/noVNC handoff

После формального закрытия MVP0 следующий milestone — **MVP1: human handoff через VNC/noVNC**.

Его задача:
- не заменить agent-driven runtime
- а добавить безопасный human-in-the-loop слой для сложных boundary:
  - auth / OTP
  - нестабильные login gates
  - безопасный payment boundary review
  - manual debug на живой session

Принципиальная модель остаётся такой же:

```text
OpenClaw skill
  -> exec
  -> browser-platform CLI
  -> browser-platform daemon
  -> Playwright
```

А рядом появляется handoff layer:

```text
daemon
  -> browser session
  -> VNC backend
  -> optional noVNC web access
```

Ключевой принцип MVP1:
- агент остаётся основным оператором сценария
- человек подключается только временно на boundary
- после handoff агент продолжает **ту же** session
- финальные рискованные действия по-прежнему не выполняются автоматически

Детальный план вынесен в отдельный артефакт: `MVP1_VNC.md`.

---

## 3. Как это подключается к OpenClaw

## 3.1 Что будет внутри OpenClaw

В OpenClaw на старте нужны только две вещи:

1. **workspace skill** — учит модель пользоваться browser-platform
2. **разрешение на `exec`** — чтобы skill мог вызывать CLI

### Примерная схема

```text
~/.openclaw/workspace/
  skills/
    browser-platform/
      SKILL.md
  browser/
    site-packs/
    traces/
    demos/
    knowledge/
```

## 3.2 Что будет вне OpenClaw

В отдельном repo/process живёт browser-platform:
- daemon
- CLI client
- Playwright runtime
- traces/demos pipeline
- VNC handoff machinery

## 3.3 Как агент будет работать пошагово

1. Пользователь просит сделать что-то на сайте.
2. Skill говорит агенту использовать browser-platform.
3. Агент вызывает CLI через `exec`.
4. CLI общается с daemon.
5. Daemon управляет Playwright.
6. CLI возвращает JSON.
7. Агент по JSON выбирает следующий шаг.
8. Если агент застрял — просит handoff.
9. После handoff пишет candidate knowledge.

---

## 4. Почему управление браузером через CLI всё ещё считается “прямым”

Важно: мы не убираем у агента пошаговый контроль.

Он по-прежнему может делать цикл:

```text
observe -> decide -> act -> verify -> repeat
```

Просто вместо нативного browser tool он будет пользоваться нашим bridge.

Например:

### Было бы в идеальном raw Playwright-мире
- открыть страницу
- кликнуть кнопку
- напечатать текст
- прочитать DOM

### У нас будет через CLI
- `session open`
- `session observe`
- `session act`
- `session snapshot`
- `handoff start`
- `resume`

То есть поведение для агента остаётся почти тем же, меняется только transport layer.

---

## 5. Минимальный CLI contract

На старте не нужен гигантский API. Нужен компактный набор команд.

## 5.1 Daemon lifecycle
- `browser-platform daemon ensure`
- `browser-platform daemon status`
- `browser-platform daemon stop`

## 5.2 Session lifecycle
- `browser-platform session open --url ... --json`
- `browser-platform session close --session ... --json`
- `browser-platform session context --session ... --json`

## 5.3 Observation
- `browser-platform session observe --session ... --json`
- `browser-platform session snapshot --session ... --json`

## 5.4 Actions
- `browser-platform session act --session ... --json '<payload>'`

Где `payload` может быть:
- `click`
- `fill`
- `type`
- `press`
- `select`
- `wait_for`
- `navigate`

## 5.5 Handoff
- `browser-platform handoff start --session ... --json`
- `browser-platform handoff status --session ... --json`
- `browser-platform handoff resume --session ... --json`

## 5.6 Knowledge writes
- `browser-platform knowledge write --session ... --json '<payload>'`
- `browser-platform knowledge list --site ... --json`

### Важный принцип
Все команды должны уметь возвращать **стабильный JSON**, а не свободный текст.

---

## 6. Что должен возвращать runtime агенту

Особенно важна команда открытия/инициализации сессии.

### `session open` должен возвращать не только `sessionId`
А сразу operational context:
- `sessionId`
- `traceId`
- `siteId`
- `supportLevel`
- `url`
- `matchedPack`
- `instructionsSummary`
- `knownRisks`
- `knownSignals`
- `candidateKnowledgeSummary`

Это нужно, чтобы агент не искал всё руками по файлам.  
CLI/daemon должен сразу собирать context packet.

---

## 7. Основные слои системы

## 7.1 Daemon
Это сердце системы.

Он отвечает за:
- Playwright browser lifecycle
- session registry
- stateful page/context storage
- VNC handoff lifecycle
- trace capture
- knowledge writes

## 7.2 CLI client
CLI — тонкий транспортный слой.

Он отвечает за:
- нормализованный command surface
- JSON input/output
- запуск/подключение к daemon
- удобный интерфейс для `exec`

## 7.3 Shared helpers
Это общий operational toolkit поверх Playwright:
- navigation helpers
- popup handling
- search helpers
- cart helpers
- validation helpers
- retry helpers
- trace hooks
- semantic action helpers

## 7.4 Site packs
Site packs — это site-specific knowledge.

Там лежит:
- manifest
- instructions
- hints
- detectors
- recoveries
- learned knowledge
- approved knowledge

## 7.5 Traces
Traces — основа дебага и источника будущего обучения.

## 7.6 Demos
Demos — это handoff sessions, где человек показывает системе, как пройти шаги.

## 7.7 Knowledge pipeline
Knowledge pipeline превращает:
- traces
- demos
- human actions
- repeated successes

в:
- candidate knowledge
- validated knowledge
- approved knowledge

---

## 8. Модель поддержки сайтов

Не все сайты должны поддерживаться одинаково.

### Level 0 — Generic
Есть только:
- домен
- стартовый URL
- краткая инструкция

Агент работает через:
- CLI
- Playwright runtime
- generic helpers

### Level 1 — Profiled
Есть:
- `instructions.md`
- `hints.json`
- common signals
- known popups
- risk notes

### Level 2 — Assisted
Есть:
- candidate/approved hints
- validators
- detectors
- recoveries
- step notes

### Level 3 — Hardened
Есть точечное усиление сложных мест:
- login flow
- add-to-cart
- checkout transitions
- нестабильные UI места

Именно это и должно масштабироваться.  
Не «писать полный адаптер для каждого сайта», а **усиливать только проблемные участки**.

---

## 9. Site packs

Site pack — это не обязательно толстый адаптер.  
Это лёгкий пакет знаний по сайту.

### Минимальный состав
- `manifest.json`
- `instructions.md`
- `hints.json`

### Расширенный состав
- `login.md`
- `checkout.md`
- `detectors.ts`
- `recoveries.ts`
- `learned/`
- `approved/`

### Что в них хранится

#### `manifest.json`
- `site_id`
- `domains`
- `start_url`
- `site_type`
- `support_level`
- `risk_flags`

#### `instructions.md`
- как устроен сайт
- как искать товар
- как понять, что товар добавился
- какие модалки типичны
- где чаще всего ломается flow

#### `hints.json`
- selector candidates
- button text candidates
- cart signals
- page signatures

#### `learned/`
Черновое знание, которое OpenClaw или demo extractor уже нашли, но ещё не утвердили.

#### `approved/`
Подтверждённое знание, на которое уже можно опираться.

---

## 10. Traces

Traces обязательны с самого начала.

Нужно хранить:
- session id
- site id
- timestamps
- action sequence
- screenshots
- DOM/HTML snapshots
- результаты validate/check
- ошибки
- recoveries
- handoff markers
- notes

### Зачем
- дебаг
- анализ поломок
- улучшение site packs
- материал для candidate knowledge

---

## 11. Human handoff via VNC

### Когда нужен handoff
- агент застрял
- появился новый UI
- generic flow перестал работать
- нужен человек для логина/OTP/CAPTCHA
- нужно помочь пройти сложный checkout step

### Что должен делать daemon в handoff
- удерживать текущую browser session
- открыть/дать VNC-доступ
- писать demonstration artifacts
- дать resume path после завершения

### Что писать во время handoff
- URL
- screenshot before/after
- DOM snapshot before/after
- raw input events
- попытку сопоставить event с DOM element
- text / role / aria-label элемента
- step order
- post-action state change

### Что важно
Не учить систему по принципу:
- “клик в координаты x/y”

А учить по принципу:
- “человек сделал semantic action над таким-то элементом на такой-то странице, и успех определился таким-то сигналом”

---

## 12. OpenClaw knowledge authoring

OpenClaw должен уметь добавлять новые знания, но аккуратно.

### Что он должен уметь записывать
- новые hints
- candidate selectors
- candidate flow order
- success signals
- recovery notes
- page signatures
- human-demo observations

### Но не должен делать на раннем этапе
- автоматически править approved knowledge без валидации
- автоматически генерировать production-ready detectors/recoveries
- автоматически переписывать весь site pack после одного прогона

### Значит нужен pipeline

```text
raw trace / demo
    ↓
candidate knowledge
    ↓
validation / replay / repeated success
    ↓
approved knowledge
```

### Метаданные для каждого knowledge object
- `source`
- `confidence`
- `created_at`
- `verification_count`
- `site_id`
- `page_signature`
- `trace_refs`

---

## 13. Структура репозитория

```text
openclaw-browser-platform/
  README.md
  ROADMAP.md

  docs/
    architecture.md
    cli-contract.md
    daemon-lifecycle.md
    site-pack-spec.md
    trace-model.md
    demo-learning.md
    safety.md
    mvp-plan.md

  bin/
    browser-platform.ts

  src/
    cli/
      main.ts
      commands/
        daemon.ts
        session.ts
        handoff.ts
        knowledge.ts

    daemon/
      server.ts
      session-registry.ts
      state-store.ts
      lifecycle.ts

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

    openclaw/
      skill-template/
        SKILL.md
      workspace-layout.ts
      install-skill.ts
      prompt-context.ts
      knowledge-writes.ts

  examples/
    demo-cli-session.ts
    demo-generic-run.ts
    demo-pack-run.ts
    demo-vnc-handoff.ts

  tests/
    unit/
    integration/
    fixtures/
```

---

## 14. Структура workspace данных

Это важно отделить от структуры repo.

```text
~/.openclaw/workspace/
  skills/
    browser-platform/
      SKILL.md

  browser/
    site-packs/
      litres/
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
    traces/
      raw/
      demos/
      replay/
    knowledge/
      inbox/
      validated/
```

---

## 15. Product increments — MVP0, MVP1, MVP2 и дальше

Это главный раздел: что реально должно существовать на каждом этапе.

---

## MVP0 — no-plugin usable foundation

### Цель
Сделать первую реально рабочую версию **без plugin**, где OpenClaw уже может пользоваться browser-platform через skill + exec + CLI.

### Что войдёт
- TypeScript foundation
- daemon + CLI skeleton
- Playwright runtime:
  - browser/session/page lifecycle
  - navigate/click/fill/type/extract/screenshot
- shared helpers v1:
  - navigation
  - popups
  - search
  - cart
  - validation
  - retries
- payment-intent extraction boundary v1:
  - детект `payecom.ru` / `platiecom.ru` / сходных checkout redirects
  - извлечение `orderId`, `bankInvoiceId`, `mdOrder`, `formUrl` и связанных полей
  - structured JSON artifact без попытки подтвердить платёж
- базовый site pack format:
  - `manifest.json`
  - `instructions.md`
  - `hints.json`
- pack loading по домену
- workspace skill `browser-platform`
- OpenClaw integration через `exec`
- stable JSON contract у CLI
- traces v1:
  - action logs
  - screenshots
  - DOM/HTML snapshots
- первый реальный site pack: **LitRes**
- LitRes pilot flow v1:
  - восстановление уже существующей авторизованной сессии
  - поиск книги по названию/автору
  - открытие карточки книги
  - добавление в корзину
  - открытие корзины
  - checkout entry
  - извлечение SberPay payment intent при появлении checkout boundary
- simple handoff marker:
  - агент может сказать, что нужна помощь человека
  - trace фиксирует остановку

### Что НЕ войдёт
- реальный VNC handoff lifecycle
- автоматическое обучение из demo
- validation pipeline
- auto-promotion knowledge
- plugin integration

### Критерий готовности
- агент может через skill вызвать CLI
- daemon держит живую browser session
- можно пройти базовый LitRes flow: поиск -> карточка -> корзина -> checkout boundary
- если на checkout boundary появляется SberPay intent, его идентификаторы можно сохранить в structured JSON без попытки подтвердить оплату
- traces позволяют понять, где сломалось

---

## MVP1 — handoff-aware system

### Цель
Добавить полноценный handoff человеку через VNC и сбор demonstration artifacts.

### Что войдёт
- handoff lifecycle:
  - pause
  - start handoff
  - resume
- VNC handoff support
- demo artifact capture:
  - screenshots before/after
  - DOM before/after
  - raw events
  - timestamps
- сохранение demo artifacts в workspace
- начальный extractor:
  - попытка понять, по какому элементу кликнули
  - какой шаг человек прошёл
  - какой сигнал success observed
- candidate knowledge format
- OpenClaw knowledge writes v1 в `learned/`
- LitRes-specific handoff use cases:
  - неожиданная модалка
  - сломанный add-to-cart
  - нестандартный переход в корзину
  - checkout entry, если UI изменился

### Что НЕ войдёт
- автоматическая промоция в approved
- сложное многошаговое обучение без валидации
- генерация production detectors/recoveries на лету

### Критерий готовности
- человек может помочь агенту через VNC
- результат этой помощи не теряется, а складывается в demos + candidate knowledge

---

## MVP2 — learning from demonstrations

### Цель
Сделать так, чтобы помощь человека реально улучшала будущие прохождения.

### Что войдёт
- action extraction v2
- candidate flow generation
- candidate selector extraction
- page signature extraction
- success signal extraction
- replay одного или нескольких candidate steps
- validated knowledge layer
- verification count/confidence updates
- поддержка mixed sources:
  - `human_demo`
  - `agent_success`
  - `manual_authoring`

### Что НЕ войдёт
- бесконтрольное автообучение
- массовая генерация hardcoded flows
- автоматический rewrite approved pack knowledge без правил

### Критерий готовности
- после 1–2 демонстраций агент проходит похожий LitRes flow стабильнее
- новые знания можно объяснить и проверить

---

## MVP3 — self-improving site packs

### Цель
Сделать так, чтобы OpenClaw мог системно наращивать site knowledge.

### Что войдёт
- candidate vs approved split как нормальный workflow
- approval rules
- trace-driven suggestions
- support level upgrades
- stronger recoveries
- resume after handoff с учётом новых знаний
- draft updates to instructions/hints/flow notes

### Что НЕ войдёт
- полное отсутствие human review на sensitive changes
- автоматическая бесконтрольная модификация approved knowledge

### Критерий готовности
- знания живут в site packs и knowledge pipeline, а не в истории чатов
- система умеет постепенно усиливать поддержку сайта

---

## MVP4 — production hardening

### Цель
Довести систему до устойчивого состояния на нескольких реальных сайтах.

### Что войдёт
- несколько реальных site packs
- стабильный handoff/resume lifecycle
- trace inspection UX
- stronger validations/recoveries
- risk layer for login/OTP/CAPTCHA/payment submit
- compatibility checks for pack changes

### Критерий готовности
- можно поддерживать несколько сайтов без ощущения, что всё держится на случайных удачах

---

## 16. Возможный следующий этап после MVP

Когда exec-based bridge станет узким местом, можно рассмотреть:
- native OpenClaw plugin
- более нативный tool surface
- tighter runtime integration

Но это **не стартовая задача**.

Стартовая задача — сначала доказать модель:

**skill + exec + CLI + daemon + site packs + traces + demos**

---

## 17. Engineering milestones

### M0 — Bootstrap
- package manager
- tsconfig
- lint/test setup
- Playwright setup
- базовый CI

### M1 — CLI + daemon skeleton
- CLI entrypoint
- daemon process
- daemon ensure/status/stop
- JSON contract baseline

### M2 — Playwright runtime
- browser/page/session lifecycle
- navigation/click/fill/extract
- screenshots/snapshots
- structured logging

### M3 — Shared helpers
- popups
- search
- cart
- validation
- retries
- trace hooks

### M4 — OpenClaw skill integration
- workspace skill template
- skill install path
- exec usage conventions
- context packet design

### M5 — Site pack spec
- manifest
- instructions
- hints
- support levels
- pack loader

### M6 — Traces v1
- trace schema
- artifact layout
- replay basics

### M7 — Handoff v1
- pause/resume
- VNC handoff
- demo artifact capture

### M8 — Candidate knowledge pipeline
- candidate formats
- action extraction
- writes to `learned/`

### M9 — Validation pipeline
- replay candidates
- confidence updates
- validated vs approved split

### M10 — Progressive hardening + release hardening
- support level upgrades
- detector/recovery injection
- docs/examples/testing matrix
- release baseline

---

## 18. MVP mapping to milestones

- **MVP0** ≈ M0 + M1 + M2 + M3 + M4 + M5 + M6
- **MVP1** ≈ MVP0 + M7 + часть M8
- **MVP2** ≈ MVP1 + M8 + M9
- **MVP3** ≈ MVP2 + часть M10
- **MVP4** ≈ MVP3 + полный M10

---

## 19. Pilot execution plan: LitRes first

Чтобы не расползаться в абстракции, первый реальный трек разработки должен идти вокруг **LitRes**.

### LitRes scope для ближайших итераций

#### MVP0 scope
- поднять daemon + CLI
- научиться открывать `litres.ru`
- научиться подхватывать существующую авторизованную сессию
- собрать первый pack `site-packs/litres/`
- пройти flow:
  - search
  - open product
  - add to cart
  - open cart

#### MVP1 scope
- handoff на LitRes через VNC
- писать demo artifacts
- учиться по ручным действиям человека на:
  - broken add-to-cart
  - broken cart open
  - changed UI elements

#### MVP2 scope
- replay candidate knowledge на LitRes
- подтверждать selectors/signals/flow notes повторным прохождением
- начинать переносить реально работающие LitRes-паттерны в shared helpers

### Зачем именно так
LitRes здесь нужен как живой тест архитектуры.  
Если модель выдержит LitRes end-to-end до корзины, значит основа daemon/CLI/skill/site-pack выбрана правильно.

---

## 20. Что делать прямо сейчас

Если двигаться прагматично, порядок такой:

1. поднять TypeScript + Playwright
2. сделать CLI + daemon skeleton
3. сделать runtime
4. сделать helper library v1
5. сделать workspace skill
6. зафиксировать site pack spec
7. сделать traces v1
8. сделать первый реальный pack: `litres`
9. потом добавлять handoff и learning вокруг LitRes flow

### Почему именно так
- без daemon невозможно нормально держать stateful browser session
- без CLI нет стабильного моста к OpenClaw
- без skill агент не поймёт, как этим пользоваться
- без traces нечем кормить learning loop
- без pack format знаниям некуда складываться

---

## 21. Первый backlog на ближайшие коммиты

### Commit 1
Bootstrap:
- package.json
- tsconfig
- eslint/prettier
- vitest/jest
- Playwright

### Commit 2
CLI + daemon:
- `bin/browser-platform.ts`
- `src/cli/*`
- `src/daemon/*`
- `daemon ensure/status`

### Commit 3
Runtime:
- browser-session
- controller
- waits
- snapshots

### Commit 4
Helpers:
- navigation
- popups
- search
- cart
- validation
- tracing helpers

### Commit 5
OpenClaw integration:
- workspace skill template
- exec contract examples
- `session open/observe/act`
- LitRes operational context packet

### Commit 6
Site packs:
- manifest
- instructions
- hints
- loader
- `litres` pack skeleton
- LitRes auth/session bootstrap notes

### Commit 7
Traces:
- trace schema
- artifact layout
- replay basics

### Commit 8
Handoff foundation:
- pause/resume markers
- demo artifact skeleton
- knowledge write skeleton

---

## 22. Самый важный итог

Стартовая архитектура проекта должна опираться на формулу:

**OpenClaw skill + exec + browser-platform CLI + daemon + Playwright + site packs + traces + demos**

А не на:
- «сразу plugin»
- «узкий API на каждый сайт»
- «сырые разрозненные shell-скрипты»
- «знания только в логах и голове модели»

Если это выдержать, то система сможет:
- быстро стартовать без тяжёлой интеграции
- сохранять stateful browser sessions
- накапливать site knowledge
- учиться у человека через VNC
- позже, при необходимости, перейти к plugin-интеграции без смены общей модели
