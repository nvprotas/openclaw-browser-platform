# LitRes checkout notes

Checkout is intentionally bounded in MVP0.

- reaching cart or checkout entry is in scope
- live validated flow now reaches LitRes purchase page `Оформление покупки` from cart via checkout login gate: `Перейти к покупке -> Другие способы -> Sber`
- on the LitRes purchase page, `СБП` and `SberPay` are distinct payment branches
- terminology is strict: `СБП`/`SBP` means `Система быстрых платежей`, while `SberPay`/`СберПей` means `SberPay`
- запрещено продолжать через `СБП`/`SBP`, если пользователь явно не просил `СБП`
- если доступны `СБП` и `Российская карта`, а пользователь явно не просил `СБП`, переключитесь с `СБП` до нажатия `Продолжить` или любой другой checkout-continue кнопки
- случайный default-выбор `СБП` считается блокирующим состоянием, а не допустимой веткой по умолчанию
- LitRes pre-submit guard: перед любым действием, которое двигает checkout дальше, проверьте, что выбранный метод не `sbp`, используя `paymentContext.paymentMethod`, `paymentContext.paymentSystem`, URL hints (`method=` / `system=`), видимый selected state или другие runtime-сигналы
- если guard видит `paymentContext.paymentMethod=sbp`, `paymentContext.paymentSystem=sbersbp`, URL hints вроде `method=sbp` / `system=sbersbp`, или выбранный видимый `СБП`, остановитесь и переключитесь на путь `Российская карта` / SberPay, если пользователь явно не просил `СБП`
- чтобы попасть в SberPay, переключитесь на `Российская карта` и нажмите `Продолжить` только после того, как pre-submit guard подтвердил, что выбранный метод не `sbp`; это открывает payment boundary `payecom.ru` (`/pay` / `/pay_ru`); не используйте верхнеуровневую опцию `СБП`
- payment method can be switched via URL parameters: replace `method=sbp&system=sbersbp` (or any other method/system pair) with `method=russian_card&system=sbercard` in the checkout URL and navigate to it; prefer this over UI clicks when the selector is unstable
- confirm the switch succeeded: URL contains `method=russian_card&system=sbercard` and the page remains on LitRes checkout (`Покупка` / `Оформление заказа`)
- on the payecom boundary, a distinct SberPay branch is exposed as `Войти по Сбер ID`
- if the user asked to reach SberPay specifically, the task is complete once this SberPay branch is reached and the structured extractor JSON is returned
- runtime auto-detect now treats `payecom` iframe/src, payecom/platiecom handoff URLs, encoded `formUrl` / `href`, and related payment params as payment-boundary signals; no manual HTML snapshot should be required just to raise `paymentContext`
- as soon as any payment identifiers become visible (`paymentOrderId`, LitRes `order`, `trace-id`, `bankInvoiceId`, `mdOrder`, `formUrl`, `merchantOrderId`, `merchantOrderNumber`), return the structured extractor JSON immediately before continuing
- if the payecom page already shows card form fields, attached-card selection, or final `Оплатить`, treat that as a safe stop boundary and report the JSON instead of pushing deeper
- final payment confirmation is out of scope; do not press `Оплатить` unless the user explicitly requests that irreversible step
- any payment submit, OTP, banking redirect, or ambiguous purchase confirmation should be treated as a stop point requiring explicit human review
