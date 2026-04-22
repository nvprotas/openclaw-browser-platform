import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import type { LoadedSitePack } from '../packs/loader.js';
import type { TimingEntry } from './types.js';
import { DEFAULT_SBER_COOKIES_PATH, fileExists, type LitresBootstrapAttemptResult } from './litres-auth.js';

export const DEFAULT_BRANDSHOP_BOOTSTRAP_OUT_DIR = '/root/.openclaw/workspace/tmp/sberid-login/brandshop';
export const REPO_OWNED_BRANDSHOP_BOOTSTRAP = 'repo:src/daemon/brandshop-auth.ts';

function isoNow(): string {
  return new Date().toISOString();
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function timedStep<T>(timeline: TimingEntry[], step: string, fn: () => Promise<T>, detail: string | null = null): Promise<T> {
  const startedAt = isoNow();
  const startedMs = Date.now();

  try {
    const result = await fn();
    timeline.push({
      step,
      startedAt,
      finishedAt: isoNow(),
      durationMs: Date.now() - startedMs,
      status: 'ok',
      detail
    });
    return result;
  } catch (error) {
    timeline.push({
      step,
      startedAt,
      finishedAt: isoNow(),
      durationMs: Date.now() - startedMs,
      status: 'error',
      detail: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

function finishedResult(
  startedMs: number,
  timeline: TimingEntry[],
  result: LitresBootstrapAttemptResult
): LitresBootstrapAttemptResult {
  return {
    ...result,
    durationMs: Date.now() - startedMs,
    timeline
  };
}

async function bodyText(page: Page): Promise<string> {
  return page.locator('body').innerText({ timeout: 2_000 }).catch(() => '');
}

async function brandshopAvatarVisible(page: Page): Promise<boolean> {
  return page.locator('.header-authorize__avatar, .header-authorize__avatar-wrapper').first().isVisible({
    timeout: 500
  }).catch(() => false);
}

async function authenticatedOnBrandshop(page: Page, finalUrl: string, text: string): Promise<boolean> {
  const lowerText = text.toLowerCase();
  return (
    /brandshop\.ru/i.test(finalUrl) &&
    !/вход или регистрация|войти по сбер id/i.test(lowerText) &&
    ((await brandshopAvatarVisible(page)) || /профиль|личный кабинет|мои заказы|выйти|самовывоз|оформление заказа/i.test(lowerText))
  );
}

async function sberEntryVisible(page: Page): Promise<boolean> {
  const sberButton = page.getByRole('button', { name: /войти по сбер id/i }).first();
  const sberText = page.getByText(/войти по сбер id/i).first();
  return (
    (await sberButton.isVisible({ timeout: 500 }).catch(() => false)) ||
    (await sberText.isVisible({ timeout: 500 }).catch(() => false))
  );
}

async function openLoginGateIfNeeded(page: Page): Promise<boolean> {
  if (await sberEntryVisible(page)) {
    return true;
  }

  const profileButton = page.locator('button[aria-label="profile"]').first();
  if (!(await profileButton.isVisible({ timeout: 1_000 }).catch(() => false))) {
    return false;
  }

  await profileButton.click({ timeout: 5_000 });
  await page.waitForTimeout(500);
  return sberEntryVisible(page);
}

async function clickSberEntryIfVisible(page: Page): Promise<boolean> {
  const sberButton = page.getByRole('button', { name: /войти по сбер id/i }).first();
  const sberText = page.getByText(/войти по сбер id/i).first();

  for (const candidate of [sberButton, sberText]) {
    if (await candidate.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await Promise.allSettled([
        page.waitForURL(/id\.sber\.ru|api\.brandshop\.ru\/xhr\/checkout\/sber_id\/callback|brandshop\.ru/i, {
          timeout: 15_000
        }),
        candidate.click({ timeout: 5_000 })
      ]);
      return true;
    }
  }

  return false;
}

async function waitForBrandshopAuthOutcome(page: Page, timeline: TimingEntry[]): Promise<{
  finalUrl: string;
  bodyText: string;
  redirectedToSberId: boolean;
  callbackReached: boolean;
  authenticatedOnBrandshop: boolean;
  rawStatus: string;
}> {
  const startedAt = isoNow();
  const startedMs = Date.now();
  let finalUrl = page.url();
  let text = '';

  while (Date.now() - startedMs < 6_000) {
    await page.waitForLoadState('domcontentloaded', { timeout: 1_500 }).catch(() => undefined);
    await page.waitForTimeout(500);
    finalUrl = page.url();
    text = await bodyText(page);
    const lowerText = text.toLowerCase();

    if (/api\.brandshop\.ru\/xhr\/checkout\/sber_id\/callback/i.test(finalUrl)) {
      break;
    }

    if (await authenticatedOnBrandshop(page, finalUrl, text)) {
      break;
    }
  }

  const redirectedToSberId = /id\.sber\.ru/i.test(finalUrl);
  const callbackReached = /api\.brandshop\.ru\/xhr\/checkout\/sber_id\/callback/i.test(finalUrl);
  const isAuthenticatedOnBrandshop = await authenticatedOnBrandshop(page, finalUrl, text);
  const rawStatus = redirectedToSberId
    ? 'redirected-to-sberid'
    : callbackReached
      ? 'brandshop-sberid-callback'
      : isAuthenticatedOnBrandshop
        ? 'authenticated-on-brandshop'
        : 'brandshop-auth-not-completed';

  timeline.push({
    step: 'wait_brandshop_auth_outcome',
    startedAt,
    finishedAt: isoNow(),
    durationMs: Date.now() - startedMs,
    status: 'ok',
    detail: `${rawStatus}:${finalUrl}`
  });

  return {
    finalUrl,
    bodyText: text,
    redirectedToSberId,
    callbackReached,
    authenticatedOnBrandshop: isAuthenticatedOnBrandshop,
    rawStatus
  };
}

async function resolveBrandshopCookiesPath(inputPath: string | undefined): Promise<string> {
  return path.resolve(inputPath ?? DEFAULT_SBER_COOKIES_PATH);
}

export async function runIntegratedBrandshopBootstrap(input: {
  matchedPack: LoadedSitePack | null;
  storageStatePath: string | null;
  cookiesPath?: string;
  outDir?: string;
  existingPage?: Page | null;
}): Promise<LitresBootstrapAttemptResult> {
  const startedMs = Date.now();
  const timeline: TimingEntry[] = [];

  if (input.matchedPack?.summary.siteId !== 'brandshop') {
    return finishedResult(startedMs, timeline, {
      attempted: false,
      ok: false,
      status: 'not_applicable',
      handoffRequired: false,
      redirectedToSberId: false,
      bootstrapFailed: false,
      usedExistingPage: Boolean(input.existingPage),
      scriptPath: null,
      statePath: input.storageStatePath,
      outDir: null,
      finalUrl: null,
      rawStatus: null,
      errorMessage: null,
      adoptedSession: null
    });
  }

  if (!input.existingPage) {
    return finishedResult(startedMs, timeline, {
      attempted: true,
      ok: false,
      status: 'failed',
      handoffRequired: false,
      redirectedToSberId: false,
      bootstrapFailed: true,
      usedExistingPage: false,
      scriptPath: REPO_OWNED_BRANDSHOP_BOOTSTRAP,
      statePath: input.storageStatePath,
      outDir: null,
      finalUrl: null,
      rawStatus: null,
      errorMessage: 'Brandshop bootstrap requires an existing page',
      adoptedSession: null
    });
  }

  const cookiesPath = await resolveBrandshopCookiesPath(input.cookiesPath);
  const outDir = path.resolve(input.outDir ?? DEFAULT_BRANDSHOP_BOOTSTRAP_OUT_DIR);
  const statePath = input.storageStatePath ? path.resolve(input.storageStatePath) : null;
  const hasCookies = await timedStep(timeline, 'check_cookies_file', () => fileExists(cookiesPath), cookiesPath);
  if (!hasCookies) {
    return finishedResult(startedMs, timeline, {
      attempted: true,
      ok: false,
      status: 'skipped_missing_cookies',
      handoffRequired: false,
      redirectedToSberId: false,
      bootstrapFailed: true,
      usedExistingPage: true,
      scriptPath: REPO_OWNED_BRANDSHOP_BOOTSTRAP,
      statePath,
      outDir,
      finalUrl: input.existingPage.url(),
      rawStatus: null,
      errorMessage: 'Sber cookies file is missing',
      adoptedSession: null
    });
  }

  await timedStep(timeline, 'ensure_out_dir', () => ensureDir(outDir), outDir);
  if (statePath) {
    await timedStep(timeline, 'ensure_state_dir', () => ensureDir(path.dirname(statePath)), path.dirname(statePath));
  }

  try {
    const page = input.existingPage;
    const context = page.context();
    const cookies = await timedStep(
      timeline,
      'read_cookies',
      async () => JSON.parse(await readFile(cookiesPath, 'utf8')) as Parameters<typeof context.addCookies>[0],
      cookiesPath
    );

    await timedStep(timeline, 'inject_cookies', () => context.addCookies(cookies));
    if (statePath) {
      await timedStep(timeline, 'persist_initial_state', () => context.storageState({ path: statePath }), statePath);
    }

    await timedStep(timeline, 'reload_after_cookie_injection', () =>
      page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => null)
    );
    await timedStep(timeline, 'stabilize_after_cookie_injection', () =>
      page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => undefined)
    );
    await timedStep(timeline, 'open_brandshop_login_gate_if_needed', () => openLoginGateIfNeeded(page));
    const clickedSberEntry = await timedStep(timeline, 'click_sber_login_entry', () => clickSberEntryIfVisible(page));
    const authFlow = clickedSberEntry
      ? await waitForBrandshopAuthOutcome(page, timeline)
      : {
          finalUrl: page.url(),
          bodyText: await bodyText(page),
          redirectedToSberId: false,
          callbackReached: false,
          authenticatedOnBrandshop: false,
          rawStatus: 'sber-login-entry-not-visible'
        };
    if (statePath) {
      await timedStep(timeline, 'persist_final_state', () => context.storageState({ path: statePath }), statePath);
    }

    await timedStep(timeline, 'capture_page_text', () => Promise.resolve(authFlow.bodyText));
    const ok = authFlow.redirectedToSberId || authFlow.callbackReached || authFlow.authenticatedOnBrandshop;

    return finishedResult(startedMs, timeline, {
      attempted: true,
      ok,
      status: authFlow.redirectedToSberId
        ? 'redirected_to_sberid'
        : authFlow.callbackReached || authFlow.authenticatedOnBrandshop
          ? 'state_refreshed'
          : 'completed_without_auth',
      handoffRequired: authFlow.redirectedToSberId,
      redirectedToSberId: authFlow.redirectedToSberId,
      bootstrapFailed: !ok,
      usedExistingPage: true,
      scriptPath: REPO_OWNED_BRANDSHOP_BOOTSTRAP,
      statePath,
      outDir,
      finalUrl: authFlow.finalUrl,
      rawStatus: authFlow.rawStatus,
      errorMessage: ok ? null : 'Brandshop Sber ID flow did not reach callback or authenticated Brandshop state',
      adoptedSession: null
    });
  } catch (error) {
    return finishedResult(startedMs, timeline, {
      attempted: true,
      ok: false,
      status: 'failed',
      handoffRequired: false,
      redirectedToSberId: false,
      bootstrapFailed: true,
      usedExistingPage: true,
      scriptPath: REPO_OWNED_BRANDSHOP_BOOTSTRAP,
      statePath,
      outDir,
      finalUrl: input.existingPage.url(),
      rawStatus: null,
      errorMessage: error instanceof Error ? error.message : String(error),
      adoptedSession: null
    });
  }
}
