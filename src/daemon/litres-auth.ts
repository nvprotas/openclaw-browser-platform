import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { LoadedSitePack } from '../packs/loader.js';
import type { TimingEntry } from './types.js';
import { DEFAULT_KUPER_STORAGE_STATE } from './kuper-auth.js';
import { launchCamoufoxBrowser, type AdoptedBrowserSession } from '../playwright/browser-session.js';
import { inferAuthState } from '../playwright/auth-state.js';
import { createEmptyPaymentContext } from '../helpers/payment-context.js';

export const DEFAULT_LITRES_STORAGE_STATE = '/root/.openclaw/workspace/tmp/sberid-login/litres/storage-state.json';
export const DEFAULT_SBER_COOKIES_PATH = '/root/.openclaw/workspace/sber-cookies.json';
export const DEFAULT_LITRES_BOOTSTRAP_OUT_DIR = '/root/.openclaw/workspace/tmp/sberid-login/litres';
export const DEFAULT_LITRES_BOOTSTRAP_ENTRY_URL = 'https://www.litres.ru/auth/login/';
export const REPO_OWNED_LITRES_BOOTSTRAP = 'repo:src/daemon/litres-auth.ts';

export interface LitresBootstrapResolution {
  storageStatePath: string | null;
  storageStateExists: boolean;
  bootstrapAttempted: boolean;
  bootstrapSource: 'explicit' | 'auto_litres' | null;
}

export interface LitresBootstrapAttemptResult {
  attempted: boolean;
  ok: boolean;
  status:
    | 'not_attempted'
    | 'reused_existing_state'
    | 'not_applicable'
    | 'skipped_missing_cookies'
    | 'redirected_to_sberid'
    | 'handoff_required'
    | 'state_refreshed'
    | 'completed_without_auth'
    | 'failed';
  handoffRequired: boolean;
  redirectedToSberId: boolean;
  bootstrapFailed: boolean;
  scriptPath: string | null;
  statePath: string | null;
  outDir: string | null;
  finalUrl: string | null;
  rawStatus: string | null;
  errorMessage: string | null;
  durationMs?: number;
  timeline?: TimingEntry[];
  adoptedSession?: AdoptedBrowserSession | null;
}

export type LitresBootstrapPageState =
  | 'handoff_sberid'
  | 'intermediate_auth'
  | 'authenticated_litres'
  | 'login_gate_litres'
  | 'anonymous_litres'
  | 'external_other';

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export function classifyLitresBootstrapPage(input: { url: string; bodyText: string }): LitresBootstrapPageState {
  const lowerUrl = input.url.toLowerCase();
  const lowerText = input.bodyText.toLowerCase();

  if (/id\.sber\.ru/.test(lowerUrl)) {
    return 'handoff_sberid';
  }

  if (/litres\.ru\/auth_proxy\//.test(lowerUrl) || /litres\.ru\/callbacks\/social-auth/.test(lowerUrl)) {
    return 'intermediate_auth';
  }

  if (/litres\.ru/.test(lowerUrl)) {
    const inferred = inferAuthState(input.url, {
      url: input.url,
      title: '',
      readyState: 'complete',
      viewport: { width: 0, height: 0 },
      visibleTexts: [input.bodyText],
      visibleButtons: [],
      forms: [],
      urlHints: [],
      pageSignatureGuess: /войти|пароль|sign in|log in/.test(lowerText) ? 'auth_form' : 'content_page',
      paymentContext: createEmptyPaymentContext()
    });

    if (inferred.state === 'authenticated') {
      return 'authenticated_litres';
    }

    if (inferred.state === 'login_gate_detected') {
      return 'login_gate_litres';
    }

    return 'anonymous_litres';
  }

  return 'external_other';
}

async function waitForLitresBootstrapOutcome(
  page: Page,
  timeline: TimingEntry[],
  options: {
    outDir: string;
    debugScreenshots: boolean;
    screenshots: string[];
  }
): Promise<{
  finalUrl: string;
  bodyText: string;
  pageState: LitresBootstrapPageState;
  rawStatus: string;
}> {
  const startedAt = isoNow();
  const startedMs = Date.now();
  let lastUrl = page.url();
  let lastText = '';
  let lastState: LitresBootstrapPageState = 'external_other';

  while (Date.now() - startedMs < 45_000) {
    await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(1_000);

    lastUrl = page.url();
    lastText = await page.locator('body').innerText().catch(() => '');
    lastState = classifyLitresBootstrapPage({ url: lastUrl, bodyText: lastText });

    if (lastState === 'handoff_sberid' || lastState === 'authenticated_litres') {
      break;
    }
  }

  await maybeScreenshot(page, path.join(options.outDir, '03-after-sber-click.png'), options.debugScreenshots, options.screenshots);

  const rawStatus =
    lastState === 'handoff_sberid'
      ? 'redirected-to-sberid'
      : lastState === 'authenticated_litres'
        ? 'authenticated-on-litres'
        : lastState === 'intermediate_auth'
          ? 'auth-proxy-timeout'
          : lastState === 'login_gate_litres'
            ? 'returned-to-login-gate'
            : lastState === 'anonymous_litres'
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

async function maybeScreenshot(page: Page, file: string, enabled: boolean, screenshots: string[]): Promise<void> {
  if (!enabled) return;
  await page.screenshot({ path: file, fullPage: true });
  screenshots.push(file);
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

export async function resolveStorageStateForSession(input: {
  requestedUrl: string;
  explicitStorageStatePath?: string;
  matchedPack: LoadedSitePack | null;
}): Promise<LitresBootstrapResolution> {
  const explicitPath = input.explicitStorageStatePath ? path.resolve(input.explicitStorageStatePath) : null;
  if (explicitPath) {
    return {
      storageStatePath: explicitPath,
      storageStateExists: await fileExists(explicitPath),
      bootstrapAttempted: true,
      bootstrapSource: 'explicit'
    };
  }

  if (input.matchedPack?.summary.siteId === 'litres') {
    return {
      storageStatePath: DEFAULT_LITRES_STORAGE_STATE,
      storageStateExists: await fileExists(DEFAULT_LITRES_STORAGE_STATE),
      bootstrapAttempted: true,
      bootstrapSource: 'auto_litres'
    };
  }

  if (input.matchedPack?.summary.siteId === 'kuper') {
    return {
      storageStatePath: DEFAULT_KUPER_STORAGE_STATE,
      storageStateExists: await fileExists(DEFAULT_KUPER_STORAGE_STATE),
      bootstrapAttempted: true,
      bootstrapSource: 'auto_litres'
    };
  }

  return {
    storageStatePath: null,
    storageStateExists: false,
    bootstrapAttempted: false,
    bootstrapSource: null
  };
}

export async function runIntegratedLitresBootstrap(input: {
  matchedPack: LoadedSitePack | null;
  storageStatePath: string | null;
  cookiesPath?: string;
  outDir?: string;
  headed?: boolean;
  debugScreenshots?: boolean;
}): Promise<LitresBootstrapAttemptResult> {
  const startedMs = Date.now();
  const timeline: TimingEntry[] = [];

  if (input.matchedPack?.summary.siteId !== 'litres') {
    return finishedResult(startedMs, timeline, {
      attempted: false,
      ok: false,
      status: 'not_applicable',
      handoffRequired: false,
      redirectedToSberId: false,
      bootstrapFailed: false,
      scriptPath: null,
      statePath: input.storageStatePath,
      outDir: null,
      finalUrl: null,
      rawStatus: null,
      errorMessage: null,
      adoptedSession: null
    });
  }

  const cookiesPath = path.resolve(input.cookiesPath ?? DEFAULT_SBER_COOKIES_PATH);
  const outDir = path.resolve(input.outDir ?? DEFAULT_LITRES_BOOTSTRAP_OUT_DIR);
  const hasCookies = await timedStep(timeline, 'check_cookies_file', () => fileExists(cookiesPath), cookiesPath);
  if (!hasCookies) {
    return finishedResult(startedMs, timeline, {
      attempted: true,
      ok: false,
      status: 'skipped_missing_cookies',
      handoffRequired: false,
      redirectedToSberId: false,
      bootstrapFailed: true,
      scriptPath: REPO_OWNED_LITRES_BOOTSTRAP,
      statePath: input.storageStatePath,
      outDir,
      finalUrl: null,
      rawStatus: null,
      errorMessage: 'Sber cookies file is missing',
      adoptedSession: null
    });
  }

  const statePath = path.resolve(input.storageStatePath ?? DEFAULT_LITRES_STORAGE_STATE);
  const screenshots: string[] = [];
  await ensureDir(outDir);
  await ensureDir(path.dirname(statePath));

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
  let stopCamoufox: (() => void) | null = null;
  let adoptedSession: AdoptedBrowserSession | null = null;

  try {
    const launched = await timedStep(timeline, 'launch_camoufox', () => launchCamoufoxBrowser());
    browser = launched.browser;
    stopCamoufox = launched.stop;
    const liveBrowser = browser;

    const reusedSavedState = await timedStep(timeline, 'check_existing_state', () => fileExists(statePath), statePath);
    context = await timedStep(
      timeline,
      'create_context',
      () =>
        reusedSavedState
          ? liveBrowser.newContext({ viewport: { width: 1440, height: 1200 }, storageState: statePath })
          : liveBrowser.newContext({ viewport: { width: 1440, height: 1200 } }),
      reusedSavedState ? 'reuse_saved_state' : 'fresh_context'
    );
    const liveContext = context;
    page = await timedStep(timeline, 'create_page', () => liveContext.newPage());
    const livePage = page;

    await timedStep(timeline, 'inject_cookies', () => liveContext.addCookies(cookies as Parameters<typeof liveContext.addCookies>[0]));
    await timedStep(timeline, 'persist_initial_state', () => liveContext.storageState({ path: statePath }), statePath);

    await timedStep(
      timeline,
      'goto_litres_login',
      () => livePage.goto(DEFAULT_LITRES_BOOTSTRAP_ENTRY_URL, { waitUntil: 'domcontentloaded', timeout: 120000 }),
      DEFAULT_LITRES_BOOTSTRAP_ENTRY_URL
    );
    await timedStep(timeline, 'stabilize_login_page', () => livePage.waitForTimeout(1500));
    await maybeScreenshot(livePage, path.join(outDir, '01-login-page.png'), Boolean(input.debugScreenshots), screenshots);

    // New login UI shows social icons directly; old UI had "Другие способы" button first.
    // Try to find Sber icon directly; if not visible, click the "..." (more) button first.
    const sberIcon = livePage.locator('img[alt="sb"]').first();
    const hasSberDirectly = await timedStep(timeline, 'check_sber_icon_direct', async () => {
      try {
        await sberIcon.waitFor({ state: 'visible', timeout: 3000 });
        return true;
      } catch {
        return false;
      }
    });

    if (!hasSberDirectly) {
      // Try legacy "Другие способы" flow
      const otherWays = livePage.locator('text=Другие способы').first();
      const hasOtherWays = await timedStep(timeline, 'check_other_ways', async () => {
        try {
          await otherWays.waitFor({ state: 'visible', timeout: 3000 });
          return true;
        } catch {
          return false;
        }
      });

      if (hasOtherWays) {
        await timedStep(timeline, 'click_other_ways', () => otherWays.click({ timeout: 10000 }));
        await timedStep(timeline, 'stabilize_other_ways', () => livePage.waitForTimeout(1500));
        await maybeScreenshot(livePage, path.join(outDir, '02-other-ways.png'), Boolean(input.debugScreenshots), screenshots);
      } else {
        // New UI: click "..." to expand more social options
        const moreButton = livePage.locator('button:has-text("...")').first();
        const hasMore = await timedStep(timeline, 'check_more_button', async () => {
          try {
            await moreButton.waitFor({ state: 'visible', timeout: 3000 });
            return true;
          } catch {
            return false;
          }
        });
        if (hasMore) {
          await timedStep(timeline, 'click_more_socials', () => moreButton.click({ timeout: 10000 }));
          await timedStep(timeline, 'stabilize_more_socials', () => livePage.waitForTimeout(1500));
          await maybeScreenshot(livePage, path.join(outDir, '02-more-socials.png'), Boolean(input.debugScreenshots), screenshots);
        }
      }
    }

    await timedStep(timeline, 'wait_sber_icon', () => sberIcon.waitFor({ state: 'visible', timeout: 30000 }));

    await timedStep(timeline, 'click_sber_login', async () => {
      await Promise.allSettled([
        livePage.waitForURL(/id\.sber\.ru|callbacks\/social-auth|litres\.ru/i, { timeout: 20000 }),
        sberIcon.click({ timeout: 10000 })
      ]);
    });

    const authFlow = await waitForLitresBootstrapOutcome(livePage, timeline, {
      outDir,
      debugScreenshots: Boolean(input.debugScreenshots),
      screenshots
    });
    await timedStep(timeline, 'persist_final_state', () => liveContext.storageState({ path: statePath }), statePath);
    await timedStep(timeline, 'capture_page_text', () => writeFile(path.join(outDir, 'page.txt'), authFlow.bodyText || '', 'utf8'));

    const finalUrl = authFlow.finalUrl;
    await timedStep(timeline, 'check_final_state', () => fileExists(statePath), statePath);

    if (authFlow.pageState === 'handoff_sberid') {
      adoptedSession = {
        browser: liveBrowser,
        context: liveContext,
        page: livePage,
        stop: stopCamoufox ?? (() => undefined)
      };

      return finishedResult(startedMs, timeline, {
        attempted: true,
        ok: true,
        status: 'redirected_to_sberid',
        handoffRequired: true,
        redirectedToSberId: true,
        bootstrapFailed: false,
        scriptPath: REPO_OWNED_LITRES_BOOTSTRAP,
        statePath,
        outDir,
        finalUrl,
        rawStatus: authFlow.rawStatus,
        errorMessage: null,
        adoptedSession
      });
    }

    if (authFlow.pageState === 'authenticated_litres') {
      adoptedSession = {
        browser: liveBrowser,
        context: liveContext,
        page: livePage,
        stop: stopCamoufox ?? (() => undefined)
      };

      return finishedResult(startedMs, timeline, {
        attempted: true,
        ok: true,
        status: 'state_refreshed',
        handoffRequired: false,
        redirectedToSberId: false,
        bootstrapFailed: false,
        scriptPath: REPO_OWNED_LITRES_BOOTSTRAP,
        statePath,
        outDir,
        finalUrl,
        rawStatus: authFlow.rawStatus,
        errorMessage: null,
        adoptedSession
      });
    }

    return finishedResult(startedMs, timeline, {
      attempted: true,
      ok: false,
      status: 'failed',
      handoffRequired: false,
      redirectedToSberId: false,
      bootstrapFailed: true,
      scriptPath: REPO_OWNED_LITRES_BOOTSTRAP,
      statePath,
      outDir,
      finalUrl,
      rawStatus: authFlow.rawStatus,
      errorMessage:
        authFlow.pageState === 'intermediate_auth'
          ? 'Bootstrap stopped on an intermediate LitRes auth page without reaching Sber ID or authenticated LitRes'
          : authFlow.pageState === 'login_gate_litres'
            ? 'Bootstrap returned to LitRes login gate without finishing authentication'
            : authFlow.pageState === 'anonymous_litres'
              ? 'Bootstrap returned to LitRes without authenticated signals'
              : `Bootstrap finished on an unsupported page: ${finalUrl}`,
      adoptedSession: null
    });
  } catch (error) {
    const errorShot = path.join(outDir, 'error.png');
    await page?.screenshot({ path: errorShot, fullPage: true }).catch(() => {});
    if (!screenshots.includes(errorShot)) screenshots.push(errorShot);

    return finishedResult(startedMs, timeline, {
      attempted: true,
      ok: false,
      status: 'failed',
      handoffRequired: false,
      redirectedToSberId: false,
      bootstrapFailed: true,
      scriptPath: REPO_OWNED_LITRES_BOOTSTRAP,
      statePath,
      outDir,
      finalUrl: page?.url() ?? null,
      rawStatus: null,
      errorMessage: error instanceof Error ? error.message : String(error),
      adoptedSession: null
    });
  } finally {
    if (!adoptedSession) {
      await page?.close().catch(() => undefined);
      await context?.close().catch(() => undefined);
      stopCamoufox?.();
      await browser?.close().catch(() => undefined);
    }
  }
}
