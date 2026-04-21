# Как добавлять новые сайты

Сейчас новый сайт в проекте обычно добавляется через новый `site-pack` в каталоге `site-packs/`.

Это важно понимать сразу:

- `site-pack` добавляет знания о сайте: домены, поддерживаемые flow, тексты кнопок, селекторы, сигналы страниц и операционные заметки.
- `site-pack` не добавляет новый runtime-код сам по себе.
- Если сайту нужен особый bootstrap/login, нестандартный checkout-flow или отдельная логика извлечения платёжных данных, кроме `site-pack` понадобятся изменения в `src/`.

## Когда достаточно только `site-pack`

Обычно достаточно одного нового пакета сайта, если:

- сайт открывается обычным `session open`
- базовые действия можно выполнить через уже существующие `navigate/click/fill/type/press/wait_for`
- поиск, открытие карточки товара и корзины можно описать через селекторы и тексты в `hints.json`
- авторизация не требует отдельного встроенного сценария

Если это не так, ориентируйтесь на `litres` как на пример сайта, для которого понадобился и `site-pack`, и отдельный bootstrap в [src/daemon/litres-auth.ts](/Users/nikolay/git/openclaw-browser-platform/src/daemon/litres-auth.ts).

## Минимальная структура

Для нового сайта создайте каталог:

```text
site-packs/<site_id>/
  manifest.json
  instructions.md
  hints.json
```

Опционально можно добавлять:

- `login.md`
- `checkout.md`
- `approved/`
- `learned/`

Сейчас loader реально читает только `manifest.json`, `instructions.md` и `hints.json`.

## Шаг 1. Создать каталог пакета

Имя каталога и `site_id` лучше держать одинаковыми. Пример:

```text
site-packs/example-shop/
```

В качестве стартовой точки удобно смотреть на [site-packs/litres/manifest.json](/Users/nikolay/git/openclaw-browser-platform/site-packs/litres/manifest.json), [site-packs/litres/instructions.md](/Users/nikolay/git/openclaw-browser-platform/site-packs/litres/instructions.md) и [site-packs/litres/hints.json](/Users/nikolay/git/openclaw-browser-platform/site-packs/litres/hints.json).

## Шаг 2. Заполнить `manifest.json`

Обязательный контракт задаётся в [src/packs/manifest.ts](/Users/nikolay/git/openclaw-browser-platform/src/packs/manifest.ts).

Минимальный шаблон:

```json
{
  "site_id": "example-shop",
  "domains": ["example.com", "www.example.com"],
  "start_url": "https://www.example.com/",
  "site_type": "store",
  "support_level": "profiled",
  "flows": ["search", "open_product", "add_to_cart", "open_cart"],
  "risk_flags": {
    "payment_requires_human": true
  }
}
```

Что важно по полям:

- `site_id`: непустая строка, стабильный идентификатор сайта.
- `domains`: список доменов, по которым сайт будет матчиться в [src/packs/loader.ts](/Users/nikolay/git/openclaw-browser-platform/src/packs/loader.ts). Матчинг идёт по `hostname === domain` и по поддоменам.
- `start_url`: рекомендуемая стартовая точка для сайта.
- `site_type`: произвольная непустая строка, нужна как описание.
- `support_level`: одно из `generic`, `profiled`, `assisted`, `hardened`.
- `flows`: список flow, которые вы реально готовы поддерживать.
- `risk_flags`: объект с булевыми флагами риска. В `packContext` попадут только ключи со значением `true`.

По `support_level` в коде сейчас проверяется только допустимость значения. Практично использовать уровни так:

- `generic`: сайт только распознаётся, но знаний мало.
- `profiled`: есть рабочие селекторы, тексты и базовые flow.
- `assisted`: flow возможен, но с заметной долей ручного участия.
- `hardened`: сценарий хорошо отработан и стабилен.

Выбирайте минимально честный уровень, а не самый оптимистичный.

## Шаг 3. Написать `instructions.md`

Парсер инструкций живёт в [src/packs/instructions.ts](/Users/nikolay/git/openclaw-browser-platform/src/packs/instructions.ts). Он берёт:

- только строки, начинающиеся с `- `

Это значит:

- операционные правила должны быть оформлены bullet-пунктами
- длинное повествование без bullet-пунктов почти бесполезно для `instructionsSummary`

Рекомендуемый формат:

```md
# Example Shop operational notes

- Начинай с главной страницы сайта.
- Используй поиск в шапке, а не внутренние виджеты рекомендаций.
- Для открытия карточки товара предпочитай ссылки из основной выдачи.
- Считай добавление в корзину успешным только после изменения UI корзины.
- Останавливайся перед необратимой оплатой или вводом чувствительных данных.
```

Содержательно сюда стоит писать:

- откуда лучше начинать сценарий
- какие элементы надёжнее нажимать
- какие модалки и login-gates мешают
- как распознавать успех действия
- где должна быть жёсткая остановка

## Шаг 4. Заполнить `hints.json`

Парсер hints живёт в [src/packs/hints.ts](/Users/nikolay/git/openclaw-browser-platform/src/packs/hints.ts). Общий принцип такой:

- в `selectors` кладём надёжные CSS-селекторы
- в `button_texts` кладём видимые тексты кнопок и ссылок
- в `page_signatures` кладём известные признаки ключевых состояний страницы

Практический шаблон:

```json
{
  "button_texts": {
    "search_submit": ["Search", "Найти"],
    "add_to_cart": ["Add to cart", "В корзину"],
    "open_cart": ["Cart", "Корзина"]
  },
  "selectors": {
    "search_input": ["input[type='search']", "[role='searchbox']"],
    "search_submit": ["button[type='submit']"],
    "search_result_link": ["main a[href*='/product/']"],
    "add_to_cart": ["button:has-text('Add to cart')"],
    "cart_link": ["a[href*='/cart']"]
  },
  "page_signatures": {
    "home": ["Каталог", "Найти", "Корзина"],
    "search_results": ["Результаты поиска", "Найдено"],
    "product_page": ["В корзину", "Купить"],
    "cart": ["Корзина", "Оформить заказ"]
  }
}
```

Что уже используется рантаймом напрямую:

- `selectors.search_input` и `button_texts.search_submit` в [src/helpers/search.ts](/Users/nikolay/git/openclaw-browser-platform/src/helpers/search.ts)
- `selectors.add_to_cart`, `selectors.cart_link`, `button_texts.add_to_cart`, `button_texts.open_cart` в [src/helpers/cart.ts](/Users/nikolay/git/openclaw-browser-platform/src/helpers/cart.ts)

Важное ограничение текущей архитектуры:

- `page_signatures` пока не управляют `pageSignatureGuess` напрямую
- `pageSignatureGuess` сейчас вычисляется эвристически в [src/playwright/browser-session.ts](/Users/nikolay/git/openclaw-browser-platform/src/playwright/browser-session.ts)
- `page_signatures` сейчас полезны как knowledge-layer, попадают в `knownSignals` и удобны для тестов и отладки

Если для нового сайта нужна более точная классификация страниц, править придётся не только `hints.json`, но и runtime-код.

## Шаг 5. Проверить, что домен матчится

Самая быстрая локальная проверка без сборки:

```bash
node --import tsx -e "import { matchSitePackByUrl } from './src/packs/loader.js'; const result = await matchSitePackByUrl('https://www.example.com/'); console.log(JSON.stringify(result, null, 2));"
```

Что нужно увидеть:

- `result` не `null`
- в `summary.siteId` ваш `site_id`
- в `summary.matchedDomain` корректный домен
- в `instructionsSummary` есть ваши ключевые пункты
- в `knownSignals` появились ваши сигнатуры

## Шаг 6. Проверить через реальный runtime

После этого проверьте интеграцию через CLI:

```bash
npm run build
node dist/bin/browser-platform.js session open --url https://www.example.com/ --json
```

В ответе проверьте `session.packContext`:

- `matchedPack: true`
- правильные `siteId`, `matchedDomain`, `flows`, `knownRisks`
- непустой `instructionsSummary`

Если `packContext.matchedPack === false`, почти всегда проблема в одном из трёх мест:

- домен не совпадает с `manifest.json`
- каталог лежит не в `site-packs/`
- один из обязательных файлов отсутствует или имеет неверный JSON/контракт

## Шаг 7. Добавить тесты

Минимум стоит повторить паттерн существующих тестов:

- [tests/unit/packs-loader.test.ts](/Users/nikolay/git/openclaw-browser-platform/tests/unit/packs-loader.test.ts)
- [tests/integration/site-pack-context.test.ts](/Users/nikolay/git/openclaw-browser-platform/tests/integration/site-pack-context.test.ts)

Практический минимум для нового сайта:

- тест на `loadSitePack(...)`
- тест на `matchSitePackByUrl(...)`
- проверка, что `instructionsSummary` не пустой
- проверка, что `knownSignals` содержит ключевые сигналы сайта

## Когда нужно править `src/`, а не только `site-packs/`

Одного пакета сайта недостаточно, если нужен хотя бы один из пунктов:

- отдельный bootstrap/login-flow по аналогии с [src/daemon/litres-auth.ts](/Users/nikolay/git/openclaw-browser-platform/src/daemon/litres-auth.ts)
- особая логика определения авторизации
- новый тип платёжной границы или извлечения платёжных параметров
- сайт плохо распознаётся текущими эвристиками `pageSignatureGuess`
- существующие helper-слои `search`/`cart` не покрывают нужный flow

В этом случае `site-pack` всё равно нужен, но это только часть интеграции.

## Короткий чек-лист

- создать `site-packs/<site_id>/`
- добавить `manifest.json`, `instructions.md`, `hints.json`
- проверить матчинг через `matchSitePackByUrl(...)`
- проверить `session.packContext` через `session open`
- добавить unit/integration тесты
- при необходимости доработать runtime в `src/`
