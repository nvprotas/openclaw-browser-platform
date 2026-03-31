# BUGS.md

Список подтверждённых багов, найденных во время разработки `openclaw-browser-platform`.

Фокус текущего этапа: **LitRes pilot**.

## Статусы

- `open` — баг подтверждён, исправления ещё нет
- `fixed` — исправлен
- `wontfix` — осознанно не исправляем в текущем scope

---

## BUG-001 — главная LitRes ошибочно классифицируется как `auth_form`

- **Статус:** `fixed`
- **Найден:** 2026-03-31
- **Область:** page classification / observe heuristics
- **Связанный этап:** Commit 3 / Playwright runtime v1

### Как воспроизвести

1. Поднять daemon:
   ```bash
   node dist/bin/browser-platform.js daemon ensure --json
   ```
2. Открыть LitRes:
   ```bash
   node dist/bin/browser-platform.js session open --url https://www.litres.ru --json
   ```
3. Вызвать observe:
   ```bash
   node dist/bin/browser-platform.js session observe --session <SESSION_ID> --json
   ```

### Фактический результат

`pageSignatureGuess` возвращается как:

```json
"auth_form"
```

### Ожидаемый результат

Для главной LitRes эвристика должна возвращать что-то вроде:
- `home`
- или `search_home`

но не `auth_form`.

### Что наблюдалось на странице

Во время smoke-теста были видны сигналы, больше похожие на главную/каталог, чем на форму авторизации:
- `Каталог`
- `Найти`
- `Корзина`
- `Мои книги`
- `Войти`
- search form с `action: /search/`

### Предполагаемая причина

Текущая эвристика слишком сильно реагирует на наличие формы и недостаточно различает:
- **поисковую форму на главной**
- и **реальную auth form**

### Идея исправления

- понизить приоритет `auth_form`, если на странице есть только обычная search form
- повысить приоритет `home/search_home`, если видны навигационные сигналы вроде:
  - каталог
  - поиск
  - корзина
  - мои книги
- отдельно учитывать action формы (`/search/`) как сигнал search/home, а не auth

### Примечание

Первоначально баг воспроизводился на ранней версии Commit 3.  
После локальных правок эвристик в action layer проблема в исходном виде больше не воспроизводится, но рядом вскрылся новый баг с классификацией `cart` (см. BUG-002).

---

## BUG-002 — LitRes home/search могут ошибочно классифицироваться как `cart`

- **Статус:** `open`
- **Найден:** 2026-03-31
- **Область:** page classification / observe heuristics
- **Связанный этап:** Commit 4 / action layer v1

### Как воспроизвести

1. Поднять daemon:
   ```bash
   node dist/bin/browser-platform.js daemon ensure --json
   ```
2. Открыть LitRes:
   ```bash
   node dist/bin/browser-platform.js session open --url https://www.litres.ru --json
   ```
3. Вызвать observe:
   ```bash
   node dist/bin/browser-platform.js session observe --session <SESSION_ID> --json
   ```
4. Либо выполнить поиск `1984` и снова вызвать `observe`.

### Фактический результат

`pageSignatureGuess` может возвращаться как:

```json
"cart"
```

даже для:
- главной страницы LitRes
- страницы результатов поиска

### Ожидаемый результат

Для этих страниц эвристика должна возвращать что-то вроде:
- `home`
- `search_results`
- `unknown`

но не `cart`.

### Что наблюдалось на странице

На главной и на поиске были видны сигналы:
- `Каталог`
- `Найти`
- `Корзина`
- `Мои книги`
- строка поиска
- результаты поиска по `1984`

Но при этом реальных cart-specific signals недостаточно, чтобы классифицировать страницу как корзину.

### Предполагаемая причина

Текущая эвристика слишком сильно повышает вес cart-like признаков при наличии слов вроде `Корзина` в общей навигации сайта.

### Идея исправления

- не считать само наличие пункта навигации `Корзина` достаточным сигналом для `cart`
- повышать `cart` только если есть более сильные признаки:
  - cart items
  - order summary
  - checkout CTA
  - пустая корзина / содержание корзины
- отдельно усилить эвристику для `search_results`:
  - query в URL (`/search/?q=`)
  - title вида `Результаты поиска ...`

---

## BUG-003 — `session context` не показывает `authContext` в CLI output после Commit 6/6.1

- **Статус:** `fixed`
- **Найден:** 2026-03-31
- **Область:** CLI serialization / session context response
- **Связанный этап:** Commit 6.1 / integrated auth bootstrap

### Как воспроизвести

1. Выполнить LitRes session open:
   ```bash
   node dist/bin/browser-platform.js session open --url https://www.litres.ru --json
   ```
2. Вызвать:
   ```bash
   node dist/bin/browser-platform.js session context --session <SESSION_ID> --json
   ```

### Фактический результат

CLI output для `session context` возвращает только базовые поля сессии:
- `sessionId`
- `url`
- `title`
- `createdAt`
- `updatedAt`
- `status`

Но не показывает ожидаемый `authContext` и pack-related enriched fields.

### Ожидаемый результат

`session context` должен возвращать расширенный контекст сессии, включая:
- `authContext`
- `packContext`
- и другие enrichment-поля, если они уже были рассчитаны runtime.

### Почему это важно

Без этого сложно:
- проверять результат integrated login/bootstrap flow
- понимать, `authenticated` мы или `anonymous`
- использовать `session context` как источник правды для planner-слоя

### Предполагаемая причина

Проблема может быть в одном из мест:
- session object режется при сериализации
- CLI output path использует не полный session payload
- daemon response возвращает урезанную форму объекта

### Идея исправления

- проверить end-to-end serialization path для `session context`
- привести `session open` и `session context` к одному формату enriched session payload
- добавить integration test именно на наличие `authContext` в CLI output

### Примечание

После свежего rebuild и живого smoke-теста на LitRes (`2026-03-31`) `session context` уже возвращал `authContext` корректно.  
Вероятно, проблема была связана с промежуточным состоянием сборки/CLI output path и в текущем состоянии больше не воспроизводится.

---

## Шаблон новой записи

```markdown
## BUG-XXX — короткое название

- **Статус:** `open`
- **Найден:** YYYY-MM-DD
- **Область:** ...
- **Связанный этап:** ...

### Как воспроизвести
1. ...
2. ...

### Фактический результат
...

### Ожидаемый результат
...

### Предполагаемая причина
...

### Идея исправления
...
```
