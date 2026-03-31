import { BrowserPlatformError } from '../core/errors.js';
import type { SessionActionPayload } from '../daemon/types.js';
import { withRetry } from '../helpers/retries.js';
import { buildPostActionObservations } from '../helpers/validation.js';
import { buildActionDiff } from '../helpers/tracing.js';
import type { BrowserSession, PageStateSummary } from '../playwright/browser-session.js';

function normalize(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

async function resolveLocator(session: BrowserSession, action: Exclude<SessionActionPayload, { action: 'navigate' | 'wait_for' }>) {
  if (action.selector) {
    return session.page().locator(action.selector).first();
  }

  if (action.role) {
    return session.page().getByRole(action.role as never, action.name ? { name: action.name } : undefined).first();
  }

  if (action.text) {
    return session.page().getByText(action.text, { exact: action.exact ?? false }).first();
  }

  throw new BrowserPlatformError('Action target requires selector, role, or text', { code: 'ACTION_TARGET_REQUIRED' });
}

async function waitForNavigationSettled(session: BrowserSession): Promise<void> {
  await Promise.race([
    session.page().waitForLoadState('domcontentloaded', { timeout: 3000 }),
    new Promise((resolve) => setTimeout(resolve, 350))
  ]);
}

export async function runStep(session: BrowserSession, payload: SessionActionPayload): Promise<{ before: PageStateSummary; after: PageStateSummary }> {
  const before = await session.observe();

  if (payload.action === 'navigate') {
    await withRetry(async () => {
      await session.page().goto(payload.url, { waitUntil: 'domcontentloaded', timeout: payload.timeoutMs ?? 15_000 });
      await session.waitForInitialLoad();
    });
  } else if (payload.action === 'wait_for') {
    if (payload.selector) {
      await session.page().waitForSelector(payload.selector, { state: payload.state ?? 'visible', timeout: payload.timeoutMs ?? 5_000 });
    } else if (payload.text) {
      await session.page().getByText(payload.text, { exact: payload.exact ?? false }).first().waitFor({ state: payload.state ?? 'visible', timeout: payload.timeoutMs ?? 5_000 });
    } else if (payload.role) {
      await session.page().getByRole(payload.role as never, payload.name ? { name: payload.name } : undefined).first().waitFor({ state: payload.state ?? 'visible', timeout: payload.timeoutMs ?? 5_000 });
    } else {
      throw new BrowserPlatformError('wait_for requires selector, text, or role', { code: 'ACTION_TARGET_REQUIRED' });
    }
  } else {
    const locator = await resolveLocator(session, payload);

    if (payload.action === 'click') {
      await withRetry(async () => {
        await locator.click({ timeout: payload.timeoutMs ?? 5_000 });
        await waitForNavigationSettled(session);
      });
    }

    if (payload.action === 'fill') {
      await locator.fill(payload.value, { timeout: payload.timeoutMs ?? 5_000 });
    }

    if (payload.action === 'type') {
      if (payload.clearFirst) {
        await locator.fill('', { timeout: payload.timeoutMs ?? 5_000 });
      }
      await locator.type(payload.value, { delay: payload.delayMs ?? 20, timeout: payload.timeoutMs ?? 5_000 });
    }

    if (payload.action === 'press') {
      await locator.press(payload.key, { delay: payload.delayMs ?? 0, timeout: payload.timeoutMs ?? 5_000 });
      await waitForNavigationSettled(session);
    }
  }

  const after = await session.observe();
  return { before, after };
}

export function buildActionResult(payload: SessionActionPayload, before: PageStateSummary, after: PageStateSummary) {
  return {
    action: payload.action,
    target: {
      selector: 'selector' in payload ? payload.selector ?? null : null,
      role: 'role' in payload ? payload.role ?? null : null,
      name: 'name' in payload ? normalize(payload.name) || null : null,
      text: 'text' in payload ? normalize(payload.text) || null : null
    },
    input: {
      value: 'value' in payload ? payload.value : null,
      url: 'url' in payload ? payload.url : null,
      key: 'key' in payload ? payload.key : null
    },
    before,
    after,
    changes: buildActionDiff(before, after),
    observations: buildPostActionObservations(before, after)
  };
}
