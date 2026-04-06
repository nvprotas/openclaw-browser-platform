# Ecomarket operational notes

- Start from `https://ecomarket.ru/` and wait for the main storefront header with search input.
- Use the header search input and search icon (`[class*='Header_search']`) to launch search.
- Confirm search route looks like `/search?q=<query>` before product actions.
- Open product from search cards via `[class*='Search_products'] [class*='PrdocutCard_cardWrapper']`.
- Product can open as modal state on the same search route (`...&product=<id>`), not as a full page.
- For `add_to_cart`, prefer modal CTA selectors such as `[class*='InnerProduct_amountBtn']`.
- Treat add-to-cart as successful when cart summary changes or cart page reports remaining amount to minimum order.
- For `open_cart`, use header cart control `[class*='HeaderCartButton_wrapper']`.
- If modal overlay blocks cart click, close modal first and retry header cart click.
- Validate cart state by URL `/cart`, cart title, or visible checkout/order form fields.
- Keep this pack in assisted mode: operator fallback is allowed for unstable overlay cases.
- Stop before irreversible checkout confirmation and payment submission.
