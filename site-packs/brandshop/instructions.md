# Brandshop operational notes

- Start from `https://brandshop.ru/` and keep navigation inside Brandshop catalog, product, cart, and checkout pages.
- Search is available at `https://brandshop.ru/search/?st=<query>`; if it fails, use `https://brandshop.ru/search/?q=<query>` or a catalog section such as `https://brandshop.ru/new/`.
- Pick a random available product link matching `/goods/<id>/<slug>/`; prefer products that show `Доступные размеры` and a visible cart CTA.
- On product pages, choose any available size before add-to-cart when no size is preselected.
- Prefer add-to-cart controls with class `_add-cart` or button text `Добавить в корзину`.
- Confirm add-to-cart by cart counter change, `1 в корзине`, cart widget update, or `Оформить заказ` becoming visible.
- For checkout, use the visible `Оформить заказ` link/button; direct `/cart/` may show a fallback state.
- If checkout opens a login gate, choose `Войти по Сбер ID`; stop for human review on OTP, CAPTCHA, or ambiguous Sber ID confirmation.
- Delivery method is fixed: choose `Самовывоз`. Do not choose courier delivery.
- Payment method is fixed: choose `SberPay`. Do not choose `СБП`; it is a different payment branch.
- Click `Подтвердить заказ` only after `Самовывоз` and `SberPay` are selected.
- Treat redirect to `https://yoomoney.ru/checkout/payments/v2/contract...` or `https://yoomoney.ru/checkout/payments/v2/contract-v2...` as the Brandshop SberPay payment boundary.
- At the YooMoney boundary, return `paymentContext.extractionJson` immediately and stop normal browser execution.
- Final payment submission, OTP, banking approval, and card payment confirmation are out of scope.
