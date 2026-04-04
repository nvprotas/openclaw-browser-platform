# Aptekalegko operational notes

- Start from `https://aptekalegko.ru/` and confirm city context (for example, `Красноярск`) before product actions.
- If a city selector modal appears, resolve it first, because catalog prices and availability are city-dependent.
- Use the header search input (`input.al-search-input`) as the primary entry point for product discovery.
- For search submission, try Enter in the search input first; if no transition happens, use a direct `/search?Find=<query>` route.
- Prefer opening products via links that include `/product/` and `productid`, not promo or category tiles.
- On product pages, verify dosage/pack variant links (`12 шт.`, `24 шт.`, etc.) before add-to-cart.
- Treat visible `В корзину` CTA on the product card/page as the add-to-cart trigger.
- Confirm add-to-cart by UI change from `В корзину` to `Оформить` or by cart counter/badge update.
- Open cart via `button[data-testid="bascet-link"]` in the header action area.
- If cart button click is unstable, use direct fallback URL `https://aptekalegko.ru/bascet-not-auth`.
- On cart page, verify signals `Корзина`, `Очистить корзину`, and non-zero item count (for example, `1 шт.`).
- Ignore passive `Войти` visibility unless an actual auth form blocks the cart flow.
- Some items may require prescription or have age restrictions; treat these as expected manual-operator decisions.
- Geo, stock, and pharmacy-availability differences can change result ordering and add-to-cart availability.
- Stop before final checkout submission, payment method selection, or any irreversible confirmation.
- If checkout steps open, hand control to operator and keep session at pre-payment boundary.
