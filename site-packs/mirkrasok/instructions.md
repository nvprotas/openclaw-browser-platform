# MirKrasok operational notes

- Start from `https://www.mirkrasok.ru/` and wait until the header search is visible.
- Use the header search input (`input[name='searchd']`) for product queries.
- Submit search with `button.btn_search` or `button.digi-ac-find__button`.
- Confirm search state by URL containing `/search` or `digiSearch=true`.
- Open products from search results using links with `/product/`.
- Validate product page by URL pattern `/product/.../sku_<id>/`.
- For add-to-cart prefer `a.btn_buy.showPopup`; use basket-style CTA fallback selectors if needed.
- Treat add-to-cart as successful when header basket text changes (for example from `0` positions to `1`) or a cart-related confirmation appears.
- Open cart with `a[href*='/personal/cart/']` first; fallback to `a.btn_head_basket` or `a.added_basket`.
- Validate cart by URL `/personal/cart/` and cart-specific checkout-step texts.
- Keep pack in assisted mode: manual fallback is acceptable when dynamic overlays block clicks.
- Stop before irreversible checkout confirmation or payment submission.
