# Texno Market operational notes

- Start from the home page and use the primary site search before opening product categories manually.
- Search is backed by forms targeting `/search/index.php`; prefer direct input+submit over Enter-only flows.
- Search results are rendered on `https://texno-market.ru/search/?q=...` and expose canonical product links under `/catalog/...`.
- Prefer clicking product links from search result cards instead of header/menu catalog links.
- Product pages are classic routes with visible product tabs such as `Описание` and `Характеристики`.
- Treat `В корзину` on a product page as add-to-cart entry point; avoid forcing checkout actions.
- Validate add-to-cart success via cart counter changes, cart popup messages, or explicit cart CTA changes when visible.
- Cart navigation target is `/personal/cart/` and can be opened from header elements with `aria-label="Ваша корзина"`.
- Presence of a header `Войти` link alone is not a login gate; continue catalog/cart flow unless an auth form is actually opened.
- Stop before final checkout confirmation, payment submission, or any irreversible purchase step.

