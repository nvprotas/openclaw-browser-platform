# LitRes checkout notes

Checkout is intentionally bounded in MVP0.

- reaching cart or checkout entry is in scope
- live validated flow now reaches LitRes purchase page `Оформление покупки` from cart via checkout login gate: `Перейти к покупке -> Другие способы -> Sber`
- on the LitRes purchase page, `СБП` and `SberPay` are distinct payment branches
- selecting `Российская карта` and pressing `Продолжить` can open a `payecom.ru` payment boundary (`/pay` / `/pay_ru`)
- on the payecom boundary, a distinct SberPay branch is exposed as `Войти по Сбер ID`
- as soon as any payment identifiers become visible (`paymentOrderId`, LitRes `order`, `trace-id`, `bankInvoiceId`, `mdOrder`, `formUrl`, `merchantOrderId`, `merchantOrderNumber`), return the structured extractor JSON immediately before continuing
- final payment confirmation is out of scope
- any payment submit, OTP, banking redirect, or ambiguous purchase confirmation should be treated as a stop point requiring explicit human review
