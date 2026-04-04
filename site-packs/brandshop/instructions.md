# Brandshop operational notes

- Start from `https://brandshop.ru/` and keep navigation inside core sections (`Новинки`, `Мужское`, `Женское`, `Бренды`).
- Search is available at `https://brandshop.ru/search/?q=<query>`; use this route if header search UI is not open yet.
- Use product links with `/goods/<id>/<slug>/` as the canonical `open_product` step.
- On product page, confirm context by `Доступные размеры` and visible `Добавить в корзину`.
- If size/variant is not preselected, choose an available size plate before add-to-cart.
- Prefer add-to-cart controls with class `_add-cart` or button text `Добавить в корзину`.
- Confirm add-to-cart by cart counter change (`aria-label="cart"` badge) or cart widget update.
- For `open_cart`, use the header cart icon/button (`aria-label="cart"`).
- Direct open of `/cart/` can show fallback/404 state; in this case return to header cart control.
- Cookie consent (`Принять`) can block interactions; accept it before continuing.
- Treat login/profile dialogs as manual-only boundaries in this assisted pack.
- Stop before final checkout confirmation and payment submission.
