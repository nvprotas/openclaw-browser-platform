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

## Recommended command order

### 1. Ensure the daemon is running

```bash
browser-platform daemon ensure --json
```

### 2. Open a session

```bash
browser-platform session open --url https://www.litres.ru/ --json
```

Optional explicit storage state:

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

If `paymentContext.shouldReportImmediately` is true, immediately return `paymentContext.extractionJson` as JSON before continuing any further checkout steps.

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

As soon as any of these appear, return `paymentContext.extractionJson` immediately before taking another step:
- `paymentOrderId`
- `litresOrder`
- `traceId`
- `bankInvoiceId`
- `mdOrder`
- `formUrl`
- `merchantOrderId`
- `merchantOrderNumber`

Return JSON only. Do not add prose around it when the task is specifically to extract payment identifiers.

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
<cwd>/.tmp/browser-platform/
```

For OpenClaw, the workspace root is the preferred `cwd`.
