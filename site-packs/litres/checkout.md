# LitRes checkout notes

Checkout is intentionally bounded in MVP0.

- reaching cart or checkout entry is in scope
- live validated flow now reaches LitRes purchase page `Оформление покупки` from cart via checkout login gate: `Перейти к покупке -> Другие способы -> Sber`
- on the LitRes purchase page, `СБП` and `SberPay` are distinct payment branches
- selecting `Российская карта` and pressing `Продолжить` can open a `payecom.ru` payment boundary (`/pay` / `/pay_ru`)
- on the payecom boundary, a distinct SberPay branch is exposed as `Войти по Сбер ID`
- if the user asked to reach SberPay specifically, the task is complete once this SberPay branch is reached and the structured extractor JSON is returned
- runtime auto-detect now treats `payecom` iframe/src, payecom/platiecom handoff URLs, encoded `formUrl` / `href`, and related payment params as payment-boundary signals; no manual HTML snapshot should be required just to raise `paymentContext`
- as soon as any payment identifiers become visible (`paymentOrderId`, LitRes `order`, `trace-id`, `bankInvoiceId`, `mdOrder`, `formUrl`, `merchantOrderId`, `merchantOrderNumber`), return the structured extractor JSON immediately before continuing
- if the payecom page already shows card form fields, attached-card selection, or final `Оплатить`, treat that as a safe stop boundary and report the JSON instead of pushing deeper
- final payment confirmation is out of scope; do not press `Оплатить` unless the user explicitly requests that irreversible step
- any payment submit, OTP, banking redirect, or ambiguous purchase confirmation should be treated as a stop point requiring explicit human review
