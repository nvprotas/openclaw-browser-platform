---
name: browser_platform
description: Use the `browser-platform` CLI for stateful browser automation through OpenClaw `exec`. Best for supported sites such as LitRes when the task needs real browser interaction, page observation, stepwise actions, screenshots, or site-pack-guided flows.
metadata: { "openclaw": { "emoji": "🌐", "requires": { "bins": ["browser-platform"] } } }
---

# Browser Platform

Use this skill when the user needs browser automation on a real site and a normal API/tool is not enough.

Current pilot support is strongest for **LitRes (`litres.ru`)** and assisted checkout flows on **Brandshop (`brandshop.ru`)**.

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

If `paymentContext.shouldReportImmediately` is true and the current gateway URL matches `https://payecom.ru/pay?...`, `https://platiecom.ru/deeplink?...`, or `https://yoomoney.ru/checkout/payments/v2/contract?...`, immediately stop normal browser execution and return the gateway interception JSON described below as the final answer. Otherwise, treat it as a checkpoint signal and continue following the user task.

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

For checkout/payment boundaries, it is acceptable to stop after extracting structured payment identifiers and before final confirmation.
If the user asked to reach SberPay specifically, the task is satisfied once you reach the SberPay branch (`payecom` boundary and/or visible `Войти по Сбер ID`) and extract the structured JSON; do not press final `Оплатить` unless the user explicitly asks for that irreversible step.

Runtime auto-detect should already raise `paymentContext` from `payecom` iframe/src, payecom/platiecom handoff URLs, and encoded payment params like `formUrl` / `href`; do not depend on manual HTML snapshots unless runtime evidence is genuinely missing.

Payment terminology (strict):

- `СБП` / `SBP` means `Система быстрых платежей` (Fast Payment System).
- `SberPay` / `СберПей` means `SberPay`.
- `СБП` and `SberPay` are completely different payment methods; never treat them as synonyms.
- In the vast majority of checkout tasks here, prioritize the `SberPay` branch unless the user explicitly asks for `СБП`.

Gateway JSON interception rule

Trigger this rule only when the browser session reaches one of these gateway URL patterns:

- `https://payecom.ru/pay?...`
- `https://platiecom.ru/deeplink?...`
- `https://yoomoney.ru/checkout/payments/v2/contract?...`
- `https://yoomoney.ru/checkout/payments/v2/contract/sberpay?...`

Do not trigger this rule for other payment-related pages, checkout states, or intermediate checkout URLs.

When either gateway URL is detected:

- stop normal browser-task execution immediately
- stop narration, summarization, and further exploration
- return exactly one JSON object and nothing else
- do not add prose, markdown, headings, commentary, numbered lists, or code fences
- use `null` for missing fields

Return this JSON shape:

```json
{
  "gateway": "payecom|platiecom|yoomoney",
  "gatewayUrl": "string",
  "paymentUrl": "string|null",
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

- Set `gateway` to `payecom` for `payecom.ru/pay?...`, `platiecom` for `platiecom.ru/deeplink?...`, and `yoomoney` for `yoomoney.ru/checkout/payments/v2/contract?...` or `/contract/sberpay?...`.
- Set `gatewayUrl` to the exact detected gateway URL.
- Set `paymentUrl` to the detected payment page URL; for YooMoney this should usually be the same as `gatewayUrl`.
- Always include `paymentIntents` as an array.
- For these gateway URLs, add one `paymentIntents` item with `provider: "sberpay"`.
- Fill `paymentIntents[0].orderId` from the gateway order identifier when available.
- For `payecom.ru/pay?...`, prefer the query `orderId` as the SberPay order identifier.
- For `platiecom.ru/deeplink?...`, extract the best available SberPay order identifier from the deeplink/query payload; otherwise use `null`.
- For `yoomoney.ru/checkout/payments/v2/contract...`, prefer the query `orderId` as the SberPay order identifier and set `paymentOrderId` to the same value.
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

## Brandshop notes

Current known Brandshop behavior:

- Open Brandshop sessions with the `brandshop` profile when possible; runtime uses the same SberID cookies path as LitRes: `/root/.openclaw/workspace/sber-cookies.json`.
- Search can be performed directly with `https://brandshop.ru/search/?q=<query>`.
- Product URLs use `/goods/<id>/<slug>/`; choose an available size before clicking `Добавить в корзину`.
- Use the header cart control or visible `Оформить заказ` action to enter checkout.
- Delivery method must be `Самовывоз`.
- Payment method must be `SberPay`; do not treat `СБП` as SberPay.
- After `Самовывоз` and `SberPay` are selected, click `Подтвердить заказ` to reach the payment boundary.
- Stop at `yoomoney.ru/checkout/payments/v2/contract?...orderId=...` or `/contract/sberpay?...orderId=...` and return the gateway JSON immediately.

## Working-directory rule

Run commands from a stable workspace directory.

The daemon state store currently lives under:

```text
<package-root>/.tmp/browser-platform/
```

For OpenClaw, the workspace root is still the preferred `cwd` for reproducible relative paths and stable execution.
