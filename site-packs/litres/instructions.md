# LitRes operational notes

- Prefer starting from the LitRes home page and using the visible search field in the site header.
- Search can surface as a combobox/searchbox rather than a plain textbox; role-based matching is often more reliable than generic input selectors.
- In an authenticated LitRes session, submitting search via `Enter` on the combobox may produce no page change; clicking the visible search button is more reliable.
- A post-login modal about merging profiles can appear and block clicks on the page. Dismiss it before search/product actions.
- If the visible LitRes UI still shows a `Войти` button, treat the session as not authenticated on the site even if other account-like signals such as `Мои книги` are also visible.
- The inner close icon (`[data-testid="icon_close"]`) may not be directly clickable; a more reliable dismissal target is the modal header close container: `div[data-testid="modal--overlay"] header > div:nth-child(2)`.
- Product pages usually expose a primary CTA such as `Купить и скачать`, `В корзину`, or another purchase/download variant near the book title and price.
- Treat add-to-cart as successful when cart-related UI changes: badge count changes, a confirmation signal appears, the CTA state changes, or a cart preview/drawer becomes visible.
- Cart entry is usually available from the persistent site header, cart badge, or a post-add confirmation area.
- At checkout entry, LitRes can show a login gate instead of the payment chooser. In live flow, `Другие способы -> Sber` was able to return in the same session to the LitRes purchase page (`Оформление покупки`).
- On LitRes checkout, `СБП` and `SberPay` are different payment branches; do not treat them as synonyms.
- Choosing `Российская карта` and pressing `Продолжить` can open a `payecom.ru` payment boundary. Inside that payecom page, a separate SberPay branch is exposed as `Войти по Сбер ID`.
- As soon as any payment identifiers appear (`paymentOrderId`, LitRes `order`, `trace-id`, `bankInvoiceId`, `mdOrder`, `formUrl`, `merchantOrderId`, `merchantOrderNumber`), return the structured extractor JSON immediately before continuing deeper into checkout.
- Stop before any final payment submission or any sensitive authentication step that requires fresh human involvement.
