# LitRes checkout notes

Checkout is intentionally bounded in MVP0.

- reaching cart or checkout entry is in scope
- live validated flow now reaches LitRes purchase page `Оформление покупки` from cart via checkout login gate: `Перейти к покупке -> Другие способы -> Sber`
- on the LitRes purchase page, `СБП` and `SberPay` are distinct payment branches
- terminology is strict: `СБП`/`SBP` means `Система быстрых платежей`, while `SberPay`/`СберПей` means `SberPay`
- in most tasks, prioritize the `SberPay` branch unless the user explicitly asks for `СБП`
- to reach SberPay, switch to `Российская карта` and press `Продолжить` — this opens the `payecom.ru` payment boundary (`/pay` / `/pay_ru`); do not use the top-level `СБП` option
- payment method can be switched via URL parameters: replace `method=sbp&system=sbersbp` (or any other method/system pair) with `method=russian_card&system=sbercard` in the checkout URL and navigate to it; prefer this over UI clicks when the selector is unstable
- confirm the switch succeeded: URL contains `method=russian_card&system=sbercard` and the page remains on LitRes checkout (`Покупка` / `Оформление заказа`)
- on the payecom boundary, a distinct SberPay branch is exposed as `Войти по Сбер ID`
- if the user asked to reach SberPay specifically, the task is complete once this SberPay branch is reached and the structured extractor JSON is returned
- runtime auto-detect now treats `payecom` iframe/src, payecom/platiecom handoff URLs, encoded `formUrl` / `href`, and related payment params as payment-boundary signals; no manual HTML snapshot should be required just to raise `paymentContext`
- as soon as any payment identifiers become visible (`paymentOrderId`, LitRes `order`, `trace-id`, `bankInvoiceId`, `mdOrder`, `formUrl`, `merchantOrderId`, `merchantOrderNumber`), return the structured extractor JSON immediately before continuing
- if the payecom page already shows card form fields, attached-card selection, or final `Оплатить`, treat that as a safe stop boundary and report the JSON instead of pushing deeper
- final payment confirmation is out of scope; do not press `Оплатить` unless the user explicitly requests that irreversible step
- any payment submit, OTP, banking redirect, or ambiguous purchase confirmation should be treated as a stop point requiring explicit human review
