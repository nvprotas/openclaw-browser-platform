# LitRes login notes

LitRes login/bootstrap is now part of the normal `browser-platform session open` flow for `litres.ru`.
It is no longer treated as a purely external pre-step.

Current operational model:

- repo-owned bootstrap implementation lives in `src/daemon/litres-auth.ts`
- default storage state path: `/root/.openclaw/workspace/tmp/sberid-login/litres/storage-state.json`
- default Sber cookies path: `/root/.openclaw/workspace/sber-cookies.json`
- bootstrap entry URL: `https://www.litres.ru/auth/login/`
- if a reusable storage state already exists, runtime reuses it and recalculates `authContext`
- if LitRes still appears anonymous or login-gated, the repo-owned bootstrap can run and persist refreshed state
- if the visible LitRes UI still shows `Войти`, treat the session as not authenticated on the site even if other account-like elements such as `Мои книги` are also visible
- bootstrap outcome is surfaced through `authContext`, including:
  - `bootstrapAttempted`
  - `bootstrapStatus`
  - `handoffRequired`
  - `redirectedToSberId`
  - `bootstrapFailed`
  - `bootstrapFinalUrl`
  - `bootstrapError`
- `redirected_to_sberid` is a valid intermediate outcome, not automatically a terminal failure; in live tests the bootstrap reached Sber redirect, and a subsequent `session open` on the refreshed state reported `authState = authenticated`
- current caveat: raw browser-export cookies may still need `sameSite` normalization before Playwright accepts them
- after login, a LitRes modal about merging profiles can appear and block clicks; a reliable close target from live testing is:
  - `div[data-testid="modal--overlay"] header > div:nth-child(2)`
- once authenticated, search submit is more reliable through the visible `Найти` button than through `Enter` on the search combobox
- stop on OTP, fresh sensitive auth challenges, or anything that looks like final purchase/payment confirmation until a human reviews it
