import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { createEmptyPaymentContext } from '../helpers/payment-context.js';
import type { LoadedSitePack } from '../packs/loader.js';
import {
  launchCamoufoxBrowser,
  type AdoptedBrowserSession
} from '../playwright/browser-session.js';
import { inferAuthState } from '../playwright/auth-state.js';
import type { TimingEntry } from './types.js';
import {
  DEFAULT_SBER_COOKIES_PATH,
  fileExists,
  type LitresBootstrapAttemptResult
} from './litres-auth.js';

export const DEFAULT_BRANDSHOP_STORAGE_STATE =
  '/root/.openclaw/workspace/sber-cookies.json';
export const DEFAULT_BRANDSHOP_BOOTSTRAP_OUT_DIR =
  '/root/.openclaw/workspace/tmp/sberid-login/brandshop';
export const DEFAULT_BRANDSHOP_BOOTSTRAP_ENTRY_URL = 'https://brandshop.ru/';
export const REPO_OWNED_BRANDSHOP_BOOTSTRAP =
  'repo:src/daemon/brandshop-auth.ts';

const SBER_LOGIN_NAME =
  /\u0432\u043e\u0439\u0442\u0438 \u043f\u043e \u0441\u0431\u0435\u0440 id|sber id/i;
const ACCEPT_COOKIE_NAME = /\u043f\u0440\u0438\u043d\u044f\u0442\u044c/i;
const AUTH_SIGNAL_REGEX =
  /\u0432\u044b\u0439\u0442\u0438|\u043b\u0438\u0447\u043d\u044b\u0439 \u043a\u0430\u0431\u0438\u043d\u0435\u0442|\u043f\u0440\u043e\u0444\u0438\u043b\u044c|my account|logout/i;

export type BrandshopBootstrapPageState =
  | 'handoff_sberid'
  | 'intermediate_callback'
  | 'authenticated_brandshop'
  | 'anonymous_brandshop'
  | 'external_other';

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function saveBodyText(page: Page, file: string): Promise<string> {
  const text = await page
    .locator('body')
    .innerText()
    .catch(() => '');
  await writeFile(file, text || '', 'utf8');
  return text || '';
}

async function maybeScreenshot(
  page: Page,
  file: string,
  enabled: boolean
): Promise<void> {
  if (!enabled) {
    return;
  }

  await page.screenshot({ path: file, fullPage: true });
}

function isoNow(): string {
  return new Date().toISOString();
}

async function timedStep<T>(
  timeline: TimingEntry[],
  step: string,
  fn: () => Promise<T>,
  detail: string | null = null
): Promise<T> {
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

export function classifyBrandshopBootstrapPage(input: {
  url: string;
  bodyText: string;
}): BrandshopBootstrapPageState {
  const lowerUrl = input.url.toLowerCase();
  const lowerText = input.bodyText.toLowerCase();

  if (/id\.sber\.ru/i.test(lowerUrl)) {
    return 'handoff_sberid';
  }

  if (/api\.brandshop\.ru\/xhr\/checkout\/sber_id\/callback/i.test(lowerUrl)) {
    return 'intermediate_callback';
  }

  if (/brandshop\.ru/i.test(lowerUrl)) {
    const inferred = inferAuthState(input.url, {
      url: input.url,
      title: '',
      readyState: 'complete',
      viewport: { width: 0, height: 0 },
      visibleTexts: [input.bodyText],
      visibleButtons: [],
      forms: [],
      urlHints: [],
      pageSignatureGuess:
        /\u0432\u043e\u0439\u0442\u0438|\u043f\u0430\u0440\u043e\u043b\u044c|sign in|log in/i.test(
          lowerText
        )
          ? 'auth_form'
          : 'content_page',
      paymentContext: createEmptyPaymentContext()
    });

    return inferred.state === 'authenticated'
      ? 'authenticated_brandshop'
      : 'anonymous_brandshop';
  }

  return 'external_other';
}

async function waitForBrandshopBootstrapOutcome(
  page: Page,
  timeline: TimingEntry[],
  timeoutMs = 45_000
): Promise<{
  finalUrl: string;
  bodyText: string;
  pageState: BrandshopBootstrapPageState;
  rawStatus: string;
}> {
  const startedAt = isoNow();
  const startedMs = Date.now();
  let lastUrl = page.url();
  let lastText = '';
  let lastState: BrandshopBootstrapPageState = 'external_other';

  while (Date.now() - startedMs < timeoutMs) {
    await page
      .waitForLoadState('domcontentloaded', { timeout: 5_000 })
      .catch(() => undefined);
    await page.waitForTimeout(1_000);

    lastUrl = page.url();
    lastText = await page
      .locator('body')
      .innerText()
      .catch(() => '');
    lastState = classifyBrandshopBootstrapPage({
      url: lastUrl,
      bodyText: lastText
    });

    if (lastState === 'authenticated_brandshop') {
      break;
    }
  }

  const rawStatus =
    lastState === 'handoff_sberid'
      ? 'redirected-to-sberid'
      : lastState === 'authenticated_brandshop'
        ? 'authenticated-on-brandshop'
        : lastState === 'intermediate_callback'
          ? 'brandshop-callback-timeout'
          : lastState === 'anonymous_brandshop'
            ? 'returned-anonymous'
            : 'external-other';

  timeline.push({
    step: 'wait_auth_flow_outcome',
    startedAt,
    finishedAt: isoNow(),
    durationMs: Date.now() - startedMs,
    status: 'ok',
    detail: `${lastState}:${lastUrl}`
  });

  return {
    finalUrl: lastUrl,
    bodyText: lastText,
    pageState: lastState,
    rawStatus
  };
}

async function clickLoginEntry(page: Page): Promise<boolean> {
  const sberButton = page
    .getByRole('button', { name: SBER_LOGIN_NAME })
    .first();
  const sberVisible = await sberButton
    .isVisible({ timeout: 1200 })
    .catch(() => false);
  if (sberVisible) {
    return true;
  }

  const profileButtonCandidates = [
    page.locator('button[aria-label="profile"]').first(),
    page.getByRole('button', { name: /profile/i }).first()
  ];

  for (const candidate of profileButtonCandidates) {
    const visible = await candidate
      .isVisible({ timeout: 1500 })
      .catch(() => false);
    if (!visible) {
      continue;
    }

    await candidate.click({ timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(700);

    const sberNowVisible = await sberButton
      .isVisible({ timeout: 1000 })
      .catch(() => false);
    if (sberNowVisible) {
      return true;
    }
  }

  return false;
}

export async function runIntegratedBrandshopBootstrap(input: {
  matchedPack: LoadedSitePack | null;
  storageStatePath: string | null;
  cookiesPath?: string;
  outDir?: string;
  headed?: boolean;
  debugScreenshots?: boolean;
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
      usedExistingPage: false,
      scriptPath: null,
      statePath: input.storageStatePath,
      outDir: null,
      finalUrl: null,
      rawStatus: null,
      errorMessage: null,
      adoptedSession: null
    });
  }

  const cookiesPath = path.resolve(
    input.cookiesPath ?? DEFAULT_SBER_COOKIES_PATH
  );
  const outDir = path.resolve(
    input.outDir ?? DEFAULT_BRANDSHOP_BOOTSTRAP_OUT_DIR
  );
  const hasCookies = await timedStep(
    timeline,
    'check_cookies_file',
    () => fileExists(cookiesPath),
    cookiesPath
  );
  if (!hasCookies) {
    return finishedResult(startedMs, timeline, {
      attempted: true,
      ok: false,
      status: 'skipped_missing_cookies',
      handoffRequired: false,
      redirectedToSberId: false,
      bootstrapFailed: true,
      usedExistingPage: false,
      scriptPath: REPO_OWNED_BRANDSHOP_BOOTSTRAP,
      statePath: input.storageStatePath,
      outDir,
      finalUrl: null,
      rawStatus: null,
      errorMessage: 'Sber cookies file is missing',
      adoptedSession: null
    });
  }

  const statePath = path.resolve(
    input.storageStatePath ?? DEFAULT_BRANDSHOP_STORAGE_STATE
  );
  await timedStep(timeline, 'ensure_out_dir', () => ensureDir(outDir), outDir);
  await timedStep(
    timeline,
    'ensure_state_dir',
    () => ensureDir(path.dirname(statePath)),
    path.dirname(statePath)
  );

  const cookies = await timedStep(
    timeline,
    'read_cookies',
    async () =>
      JSON.parse(await readFile(cookiesPath, 'utf8')) as Array<{
        name: string;
        value: string;
        domain: string;
        path: string;
        expires?: number;
        httpOnly?: boolean;
        secure?: boolean;
        sameSite?: 'Strict' | 'Lax' | 'None';
      }>,
    cookiesPath
  );

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let stopCamoufox: (() => Promise<void>) | null = null;
  let adoptedSession: AdoptedBrowserSession | null = null;
  const usingExistingPage = Boolean(input.existingPage);

  try {
    if (input.existingPage) {
      page = input.existingPage;
      context = page.context();
    } else {
      const launched = await timedStep(timeline, 'launch_camoufox', () =>
        launchCamoufoxBrowser()
      );
      browser = launched.browser;
      stopCamoufox = launched.stop;

      const reusedSavedState = await timedStep(
        timeline,
        'check_existing_state',
        () => fileExists(statePath),
        statePath
      );
      context = await timedStep(
        timeline,
        'create_context',
        () =>
          reusedSavedState
            ? browser!.newContext({
                viewport: { width: 1440, height: 1200 },
                storageState: statePath
              })
            : browser!.newContext({ viewport: { width: 1440, height: 1200 } }),
        reusedSavedState ? 'reuse_saved_state' : 'fresh_context'
      );
      page = await timedStep(timeline, 'create_page', () => context!.newPage());
    }

    const livePage = page;
    const liveContext = context;
    if (!livePage || !liveContext) {
      throw new Error('Brandshop bootstrap could not initialize page/context');
    }

    await timedStep(timeline, 'inject_cookies', () =>
      liveContext.addCookies(
        cookies as Parameters<typeof liveContext.addCookies>[0]
      )
    );
    await timedStep(
      timeline,
      'persist_initial_state',
      () => liveContext.storageState({ path: statePath }),
      statePath
    );

    await timedStep(
      timeline,
      'goto_brandshop_home',
      () =>
        livePage.goto(DEFAULT_BRANDSHOP_BOOTSTRAP_ENTRY_URL, {
          waitUntil: 'domcontentloaded',
          timeout: 120000
        }),
      DEFAULT_BRANDSHOP_BOOTSTRAP_ENTRY_URL
    );
    await timedStep(timeline, 'stabilize_home', () =>
      livePage.waitForTimeout(1300)
    );
    await maybeScreenshot(
      livePage,
      path.join(outDir, '01-home.png'),
      Boolean(input.debugScreenshots)
    );

    const cookieAccept = livePage
      .getByRole('button', { name: ACCEPT_COOKIE_NAME })
      .first();
    const cookieVisible = await cookieAccept
      .isVisible({ timeout: 1200 })
      .catch(() => false);
    if (cookieVisible) {
      await timedStep(timeline, 'accept_cookie', () =>
        cookieAccept.click({ timeout: 7000 })
      );
      await timedStep(timeline, 'stabilize_after_cookie', () =>
        livePage.waitForTimeout(500)
      );
    }

    let openedLoginEntry = await timedStep(
      timeline,
      'open_sber_login_entry_home',
      () => clickLoginEntry(livePage)
    );
    if (!openedLoginEntry) {
      await timedStep(
        timeline,
        'goto_brandshop_checkout',
        () =>
          livePage.goto('https://brandshop.ru/checkout/', {
            waitUntil: 'commit',
            timeout: 60000
          }),
        'https://brandshop.ru/checkout/'
      );
      await timedStep(timeline, 'stabilize_checkout', async () => {
        await livePage
          .waitForLoadState('domcontentloaded', { timeout: 5000 })
          .catch(() => undefined);
        await livePage.waitForTimeout(900);
      });

      openedLoginEntry = await timedStep(
        timeline,
        'open_sber_login_entry_checkout',
        () => clickLoginEntry(livePage)
      );
    }

    const sberButton = livePage
      .getByRole('button', { name: SBER_LOGIN_NAME })
      .first();
    const sberVisible = await sberButton
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    if (!openedLoginEntry || !sberVisible) {
      const currentText = await saveBodyText(
        livePage,
        path.join(outDir, 'page.txt')
      );
      await timedStep(
        timeline,
        'persist_state_without_sber',
        () => liveContext.storageState({ path: statePath }),
        statePath
      );
      const stateExists = await timedStep(
        timeline,
        'check_saved_state_after_no_sber',
        () => fileExists(statePath),
        statePath
      );
      const maybeAuthenticated = AUTH_SIGNAL_REGEX.test(
        currentText.toLowerCase()
      );

      return finishedResult(startedMs, timeline, {
        attempted: true,
        ok: stateExists,
        status: maybeAuthenticated
          ? 'state_refreshed'
          : 'completed_without_auth',
        handoffRequired: false,
        redirectedToSberId: false,
        bootstrapFailed: !stateExists,
        usedExistingPage: usingExistingPage,
        scriptPath: REPO_OWNED_BRANDSHOP_BOOTSTRAP,
        statePath,
        outDir,
        finalUrl: livePage.url(),
        rawStatus: maybeAuthenticated
          ? 'already-authenticated'
          : 'sber-entry-not-found',
        errorMessage: maybeAuthenticated
          ? null
          : 'Sber ID login entry is not visible on Brandshop checkout',
        adoptedSession: null
      });
    }

    await maybeScreenshot(
      livePage,
      path.join(outDir, '02-login-sheet.png'),
      Boolean(input.debugScreenshots)
    );

    await timedStep(timeline, 'click_sber_login', async () => {
      await Promise.allSettled([
        livePage.waitForURL(/id\.sber\.ru|brandshop\.ru|api\.brandshop\.ru/i, {
          timeout: 25000
        }),
        sberButton.click({ timeout: 10000 })
      ]);
    });

    const authFlow = await waitForBrandshopBootstrapOutcome(livePage, timeline);
    await writeFile(
      path.join(outDir, 'page.txt'),
      authFlow.bodyText || '',
      'utf8'
    );
    await maybeScreenshot(
      livePage,
      path.join(outDir, '03-after-sber-click.png'),
      Boolean(input.debugScreenshots)
    );
    await timedStep(
      timeline,
      'persist_final_state',
      () => liveContext.storageState({ path: statePath }),
      statePath
    );

    const redirectedToSberId = authFlow.pageState === 'handoff_sberid';
    const maybeAuthenticated = authFlow.pageState === 'authenticated_brandshop';
    const stateExists = await timedStep(
      timeline,
      'check_saved_state_after_bootstrap',
      () => fileExists(statePath),
      statePath
    );

    if (redirectedToSberId) {
      if (!usingExistingPage) {
        adoptedSession = {
          browser: browser!,
          context: liveContext,
          page: livePage,
          stop: stopCamoufox ?? (async () => undefined)
        };
      }

      return finishedResult(startedMs, timeline, {
        attempted: true,
        ok: true,
        status: 'redirected_to_sberid',
        handoffRequired: true,
        redirectedToSberId: true,
        bootstrapFailed: false,
        usedExistingPage: usingExistingPage,
        scriptPath: REPO_OWNED_BRANDSHOP_BOOTSTRAP,
        statePath,
        outDir,
        finalUrl: authFlow.finalUrl,
        rawStatus: authFlow.rawStatus,
        errorMessage: null,
        adoptedSession
      });
    }

    if (maybeAuthenticated) {
      if (!usingExistingPage) {
        adoptedSession = {
          browser: browser!,
          context: liveContext,
          page: livePage,
          stop: stopCamoufox ?? (async () => undefined)
        };
      }

      return finishedResult(startedMs, timeline, {
        attempted: true,
        ok: true,
        status: 'state_refreshed',
        handoffRequired: false,
        redirectedToSberId: false,
        bootstrapFailed: false,
        usedExistingPage: usingExistingPage,
        scriptPath: REPO_OWNED_BRANDSHOP_BOOTSTRAP,
        statePath,
        outDir,
        finalUrl: authFlow.finalUrl,
        rawStatus: authFlow.rawStatus,
        errorMessage: null,
        adoptedSession
      });
    }

    return finishedResult(startedMs, timeline, {
      attempted: true,
      ok: stateExists,
      status: 'completed_without_auth',
      handoffRequired: false,
      redirectedToSberId: false,
      bootstrapFailed: !stateExists,
      usedExistingPage: usingExistingPage,
      scriptPath: REPO_OWNED_BRANDSHOP_BOOTSTRAP,
      statePath,
      outDir,
      finalUrl: authFlow.finalUrl,
      rawStatus: authFlow.rawStatus,
      errorMessage:
        stateExists && authFlow.pageState !== 'intermediate_callback'
          ? null
          : authFlow.pageState === 'intermediate_callback'
            ? 'Bootstrap stopped on Brandshop callback without redirecting to Sber ID or authenticated Brandshop'
            : 'Bootstrap finished without producing a reusable state file',
      adoptedSession: null
    });
  } catch (error) {
    const errorShot = path.join(outDir, 'error.png');
    await page
      ?.screenshot({ path: errorShot, fullPage: true })
      .catch(() => undefined);

    return finishedResult(startedMs, timeline, {
      attempted: true,
      ok: false,
      status: 'failed',
      handoffRequired: false,
      redirectedToSberId: false,
      bootstrapFailed: true,
      usedExistingPage: usingExistingPage,
      scriptPath: REPO_OWNED_BRANDSHOP_BOOTSTRAP,
      statePath,
      outDir,
      finalUrl: page?.url() ?? null,
      rawStatus: null,
      errorMessage: error instanceof Error ? error.message : String(error),
      adoptedSession: null
    });
  } finally {
    if (!usingExistingPage && !adoptedSession) {
      await page?.close().catch(() => undefined);
      await context?.close().catch(() => undefined);
      await Promise.allSettled([
        browser?.close().catch(() => undefined) ?? Promise.resolve(undefined),
        stopCamoufox?.().catch(() => undefined) ?? Promise.resolve(undefined)
      ]);
    }
  }
}
