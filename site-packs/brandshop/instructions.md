# Brandshop operational notes

- Start from `https://brandshop.ru/` and keep navigation inside Brandshop catalog/product/checkout pages.
- Normalize search query before navigation: trim, collapse spaces, remove trailing punctuation (`?`, `!`, `.`, `,`), then URL-encode.
- Use `https://brandshop.ru/search/?st=<encoded_query>` as the primary search route.
- If primary route has empty-state (`По этому запросу ничего не найдено`) or no `/goods/...` links, fallback to `https://brandshop.ru/search/?q=<encoded_query>`.
- Use product links with `/goods/<id>/<slug>/` as the canonical `open_product` step.
- On search results, prefer cards matching query tokens (brand + category); for footwear queries, prefer `Кроссовки`/`Sneakers` cards.
- On product pages, confirm context by `Доступные размеры` and visible `Добавить в корзину`.
- If size/variant is not preselected, choose an available size plate before add-to-cart.
- Prefer add-to-cart controls with class `_add-cart` or button text `Добавить в корзину`.
- Confirm add-to-cart by cart counter change, cart widget update, or `Оформить заказ` becoming visible.
- For `open_cart`, use the header cart icon/button (`aria-label="cart"`); direct `/cart/` can show a fallback state.
- For checkout, use `Оформить заказ` and validate that `/checkout/` or `Оформление заказа` is visible.
- Choose delivery method `Самовывоз`, then choose payment method `SberPay`; do not choose `СБП` because it is a different payment branch.
- Click `Подтвердить заказ` only after `Самовывоз` and `SberPay` are selected.
- Treat redirect to `yoomoney.ru/checkout/payments/v2/contract?...orderId=...` as the payment boundary.
- Return payment parameters only at the YooMoney boundary via `paymentContext.extractionJson`, then stop normal browser execution before irreversible payment steps.
