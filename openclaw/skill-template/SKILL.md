---
name: browser_platform
description: Use the `browser-platform` CLI for stateful browser automation through OpenClaw `exec`. Best for supported sites such as LitRes when the task needs real browser interaction, page observation, stepwise actions, screenshots, or site-pack-guided flows.
metadata: { "openclaw": { "emoji": "🌐", "requires": { "bins": ["browser-platform"] } } }
---

# Browser Platform

Use this skill when the user needs browser automation on a real site and a normal API/tool is not enough.

Current pilot support is strongest for **LitRes (`litres.ru`)**.

## Core rule

Treat `browser-platform` as a **stateful browser runtime**.
Call it through OpenClaw `exec`, not as a made-up native tool.
Do not fire one-off unrelated commands blindly.
Prefer the loop:

```text
daemon ensure
-> session open
-> session context
-> session observe
-> decide
-> session act
-> verify
-> repeat
```

Always request `--json` output.
When using OpenClaw `exec`, set `workdir` / `cwd` to the workspace root for reproducible relative paths and stable execution.
When calling `exec` for `browser-platform` commands, keep `yieldMs` short: use `yieldMs: 7000` (or less) by default, and never exceed 7000. If an operation may take longer, run with short `yieldMs` and continue via `process(action=poll, timeout=...)` instead of a large single `yieldMs`.
Do not pipe `browser-platform --json` output into `python`, `node`, `jq`, heredoc scripts, or other post-processors inside `exec`. OpenClaw already returns the command output; read the JSON from the tool result directly. In particular, never use `browser-platform ... --json | python3 - <<'PY' ...`: the heredoc consumes stdin and the JSON pipe can be lost, causing `JSONDecodeError`.
If `exec` returns `Command still running`, poll the same process and use the JSON returned by that process. Do not rerun `session open` only to extract `sessionId`; this creates duplicate browser sessions and loses time.

## Recommended command order

### 1. Ensure the daemon is running

```bash
browser-platform daemon ensure --json
```

### 2. Open a session

Canonical profile/scenario flow:

```bash
browser-platform session open \
  --url https://www.litres.ru/ \
  --profile litres \
  --scenario open-home \
  --json
```

For LitRes book-search tasks, open the search URL directly instead of opening the home page and then filling the search field:

```bash
browser-platform session open \
  --url 'https://www.litres.ru/search/?q=Одиссея%20Гомер' \
  --profile litres \
  --scenario open-home \
  --json
```

After this, use the returned `session.sessionId` from the JSON object as-is.

Legacy/debug/import override for an external state file:

```bash
browser-platform session open \
  --url https://www.litres.ru/ \
  --storage-state /absolute/path/to/storage-state.json \
  --json
```

### 3. Read session context

```bash
browser-platform session context --session <SESSION_ID> --json
```

Check:
- `packContext`
- `authContext`
- `paymentContext`
- whether the matched pack is LitRes
- whether auth is `authenticated`, `anonymous`, or `login_gate_detected`
- whether payment identifiers or a payment boundary were already detected

### 4. Observe before acting

```bash
browser-platform session observe --session <SESSION_ID> --json
```

Use observation to decide the next step.

If `paymentContext.shouldReportImmediately` is true and the current gateway URL matches `https://payecom.ru/pay?...` or `https://platiecom.ru/deeplink?...`, immediately stop normal browser execution and return the gateway interception JSON described below as the final answer. Otherwise, treat it as a checkpoint signal and continue following the user task.

### 5. Act in small steps

Examples:

```bash
browser-platform session act --session <SESSION_ID> --json '{"action":"click","role":"button","name":"Найти"}'
```

```bash
browser-platform session act --session <SESSION_ID> --json '{"action":"fill","role":"combobox","value":"1984"}'
```

```bash
browser-platform session act --session <SESSION_ID> --json '{"action":"wait_for","selector":"div[data-testid=\"modal--overlay\"]","state":"visible"}'
```

### 6. Snapshot when debugging or before risky transitions

```bash
browser-platform session snapshot --session <SESSION_ID> --json
```

### 7. Close the session when done

```bash
browser-platform session close --session <SESSION_ID> --json
```

## Safety and stopping rules

Stop and ask for review if you hit:

- OTP / fresh authentication challenge
- CAPTCHA
- final payment submit
- banking redirect you do not fully understand
- anything that looks like irreversible purchase confirmation

Для commerce-задач на LitRes не считайте обратимые шаги покупки точками ревью. Если пользователь попросил купить, заказать, добавить в корзину, оформить покупку или дойти до SberPay, продолжайте без дополнительных подтверждений через:

- поиск нужной книги
- открытие карточки товара
- добавление книги в корзину
- открытие корзины
- нажатие checkout / `Перейти к покупке`
- выбор или переключение способа оплаты на `Российская карта` / SberPay
- нажатие checkout-continue кнопок, нужных для перехода к SberPay payment boundary

Эти обратимые шаги являются частью поручения пользователя, а не необратимым подтверждением покупки.

На checkout/payment boundary останавливайтесь только после извлечения структурированных платежных идентификаторов и до финального подтверждения.
Если пользователь попросил дойти до SberPay, задача выполнена только после достижения SberPay gateway/payment boundary (`payecom` или `platiecom`) и возврата структурированного JSON. Видимая ветка `Войти по Сбер ID` без извлеченных идентификаторов является checkpoint: продолжайте использовать `session context`, `observe`, runtime `paymentContext` и gateway URL, пока JSON можно будет заполнить. Не нажимайте финальный `Оплатить`, не отправляйте OTP и не подтверждайте банковский платеж, если пользователь явно не попросил этот необратимый шаг.

Runtime auto-detect should already raise `paymentContext` from `payecom` iframe/src, payecom/platiecom handoff URLs, and encoded payment params like `formUrl` / `href`; do not depend on manual HTML snapshots unless runtime evidence is genuinely missing.

Payment terminology (strict):
- `СБП` / `SBP` means `Система быстрых платежей` (Fast Payment System).
- `SberPay` / `СберПей` means `SberPay`.
- `СБП` and `SberPay` are completely different payment methods; never treat them as synonyms.
- На LitRes checkout запрещено продолжать через `СБП` / `SBP`, если пользователь явно не просил `СБП`.
- Если на LitRes checkout видны `СБП` и `Российская карта`, а пользователь явно не просил `СБП`, переключение с `СБП` обязательно до нажатия любой кнопки продолжения checkout.
- Случайный default-выбор `СБП` считается блокирующим состоянием, а не допустимой веткой по умолчанию.
- Перед нажатием кнопки продолжения LitRes checkout проверьте по `paymentContext.paymentMethod`, `paymentContext.paymentSystem`, URL hints вроде `method=` / `system=`, видимому selected state или другим доступным runtime-сигналам, что выбранный метод не `sbp`.
- LitRes pre-submit guard: если `paymentContext.paymentMethod=sbp`, `paymentContext.paymentSystem=sbersbp`, URL hints содержат `method=sbp` / `system=sbersbp`, или видимый выбранный способ оплаты — `СБП`, остановитесь и переключитесь на путь `Российская карта` / SberPay, если пользователь явно не просил `СБП`.
- Для обычных задач покупки на LitRes, где пользователь не просил `СБП`, продолжайте только через путь `Российская карта` / SberPay.

Gateway JSON interception rule

Trigger this rule only when the browser session reaches one of these gateway URL patterns:
- `https://payecom.ru/pay?...`
- `https://platiecom.ru/deeplink?...`

Do not trigger this rule for other payment-related pages, checkout states, or intermediate checkout URLs.
Если видна ветка SberPay, но еще нет gateway URL или платежных идентификаторов, продолжайте вести checkout к gateway; не останавливайтесь для подтверждения и не возвращайте текстовый статус.

When either gateway URL is detected:
- stop normal browser-task execution immediately
- stop narration, summarization, and further exploration
- return exactly one JSON object and nothing else
- do not add prose, markdown, headings, commentary, numbered lists, or code fences
- use `null` for missing fields

Return this JSON shape:

```json
{
  "gateway": "payecom|platiecom",
  "gatewayUrl": "string",
  "paymentIntents": [
    {
      "provider": "sberpay",
      "orderId": "string|null"
    }
  ],
  "paymentOrderId": "string|null",
  "litresOrder": "string|null",
  "traceId": "string|null",
  "bankInvoiceId": "string|null",
  "mdOrder": "string|null",
  "formUrl": "string|null",
  "merchantOrderId": "string|null",
  "merchantOrderNumber": "string|null",
  "deeplink": "string|null"
}
```

Mapping rules:
- Set `gateway` to `payecom` for `payecom.ru/pay?...` and `platiecom` for `platiecom.ru/deeplink?...`.
- Set `gatewayUrl` to the exact detected gateway URL.
- Always include `paymentIntents` as an array.
- For these gateway URLs, add one `paymentIntents` item with `provider: "sberpay"`.
- Fill `paymentIntents[0].orderId` from the gateway order identifier when available.
- For `payecom.ru/pay?...`, prefer the query `orderId` as the SberPay order identifier.
- For `platiecom.ru/deeplink?...`, extract the best available SberPay order identifier from the deeplink/query payload; otherwise use `null`.
- Если `paymentContext` уже содержит payment order identifier для того же gateway, используйте его для заполнения `paymentIntents[0].orderId` и `paymentOrderId`.
- Populate the remaining top-level fields from runtime evidence when available; otherwise use `null`.

This gateway interception rule overrides normal browser automation response style.

## LitRes notes

Current known LitRes behavior:

- search input may match better as `combobox` or `searchbox` than `textbox`
- in authenticated sessions, clicking the visible `Найти` button is more reliable than pressing `Enter`
- if the visible LitRes UI still shows `Войти`, treat the session as not authenticated on the site even if other account-like elements such as `Мои книги` are also visible
- after login, a merge-profiles modal can block clicks
- a reliable close target from live testing is:
  - `div[data-testid="modal--overlay"] header > div:nth-child(2)`

## Working-directory rule

Run commands from a stable workspace directory.

The daemon state store currently lives under:

```text
<package-root>/.tmp/browser-platform/
```

For OpenClaw, the workspace root is still the preferred `cwd` for reproducible relative paths and stable execution.
