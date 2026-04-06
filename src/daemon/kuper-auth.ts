import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser, Page } from 'playwright';
import { fileExists } from './litres-auth.js';
import { launchCamoufoxBrowser } from '../playwright/browser-session.js';

export const DEFAULT_KUPER_STORAGE_STATE = '/root/.openclaw/workspace/tmp/sberid-login/kuper/storage-state.json';
export const DEFAULT_KUPER_BOOTSTRAP_OUT_DIR = '/root/.openclaw/workspace/tmp/sberid-login/kuper';
export const DEFAULT_KUPER_BOOTSTRAP_ENTRY_URL = 'https://kuper.ru/';
export const DEFAULT_SBER_COOKIES_PATH = '/root/.openclaw/workspace/sber-cookies.json';
export const REPO_OWNED_KUPER_BOOTSTRAP = 'repo:src/daemon/kuper-auth.ts';

export interface KuperBootstrapAttemptResult {
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
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function saveBodyText(page: Page, file: string): Promise<string> {
  const text = await page.locator('body').innerText().catch(() => '');
  await writeFile(file, text || '', 'utf8');
  return text || '';
}

async function maybeScreenshot(page: Page, file: string, enabled: boolean, screenshots: string[]): Promise<void> {
  if (!enabled) return;
  await page.screenshot({ path: file, fullPage: true });
  screenshots.push(file);
}

export async function runIntegratedKuperBootstrap(input: {
  storageStatePath: string | null;
  cookiesPath?: string;
  outDir?: string;
  headed?: boolean;
  debugScreenshots?: boolean;
}): Promise<KuperBootstrapAttemptResult> {
  const cookiesPath = path.resolve(input.cookiesPath ?? DEFAULT_SBER_COOKIES_PATH);
  const outDir = path.resolve(input.outDir ?? DEFAULT_KUPER_BOOTSTRAP_OUT_DIR);

  if (!(await fileExists(cookiesPath))) {
    return {
      attempted: true,
      ok: false,
      status: 'skipped_missing_cookies',
      handoffRequired: false,
      redirectedToSberId: false,
      bootstrapFailed: true,
      scriptPath: REPO_OWNED_KUPER_BOOTSTRAP,
      statePath: input.storageStatePath,
      outDir,
      finalUrl: null,
      rawStatus: null,
      errorMessage: 'Sber cookies file is missing'
    };
  }

  const statePath = path.resolve(input.storageStatePath ?? DEFAULT_KUPER_STORAGE_STATE);
  const screenshots: string[] = [];
  await ensureDir(outDir);
  await ensureDir(path.dirname(statePath));

  const cookies = JSON.parse(await readFile(cookiesPath, 'utf8')) as Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
  }>;

  let stopCamoufox: (() => void) | null = null;
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    const launched = await launchCamoufoxBrowser();
    browser = launched.browser;
    stopCamoufox = launched.stop;

    const reusedSavedState = await fileExists(statePath);
    const context = reusedSavedState
      ? await browser.newContext({ viewport: { width: 1440, height: 1200 }, storageState: statePath })
      : await browser.newContext({ viewport: { width: 1440, height: 1200 } });
    page = await context.newPage();

    await context.addCookies(cookies as Parameters<typeof context.addCookies>[0]);
    await context.storageState({ path: statePath });

    await page.goto(DEFAULT_KUPER_BOOTSTRAP_ENTRY_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });

    // Wait up to 30s for anti-bot JS challenge to resolve and redirect back to kuper.ru
    await page.waitForURL(
      (url) => !/hcheck=/i.test(url.toString()) && !/\/xpvnsulc\//i.test(url.toString()),
      { timeout: 30000 }
    ).catch(() => {});

    await page.waitForTimeout(2000);
    await maybeScreenshot(page, path.join(outDir, '01-home.png'), Boolean(input.debugScreenshots), screenshots);

    // Check for anti-bot challenge
    const afterGotoUrl = page.url();
    if (/hcheck=/i.test(afterGotoUrl) || /\/xpvnsulc\//i.test(afterGotoUrl)) {
      await saveBodyText(page, path.join(outDir, 'page.txt'));
      await context.storageState({ path: statePath });
      return {
        attempted: true,
        ok: false,
        status: 'handoff_required',
        handoffRequired: true,
        redirectedToSberId: false,
        bootstrapFailed: false,
        scriptPath: REPO_OWNED_KUPER_BOOTSTRAP,
        statePath,
        outDir,
        finalUrl: afterGotoUrl,
        rawStatus: 'anti_bot_challenge',
        errorMessage: 'Anti-bot challenge detected on kuper.ru even with camoufox'
      };
    }

    // Check if already authenticated (kuper.ru session cookies might be valid)
    const homeText = await page.locator('body').innerText().catch(() => '');
    const homeLowered = homeText.toLowerCase();
    const alreadyAuth = /профил|выйти|личный кабинет/i.test(homeLowered);
    if (alreadyAuth) {
      await context.storageState({ path: statePath });
      return {
        attempted: true,
        ok: true,
        status: 'state_refreshed',
        handoffRequired: false,
        redirectedToSberId: false,
        bootstrapFailed: false,
        scriptPath: REPO_OWNED_KUPER_BOOTSTRAP,
        statePath,
        outDir,
        finalUrl: afterGotoUrl,
        rawStatus: 'already-authenticated',
        errorMessage: null
      };
    }

    // Find and click the login button — race against anti-bot redirect
    const loginBtn = page.locator('text=Войти').first();
    try {
      await loginBtn.waitFor({ state: 'visible', timeout: 25000 });
    } catch {
      // Check if anti-bot redirect happened during the wait
      const urlAfterWait = page.url();
      if (/hcheck=/i.test(urlAfterWait) || /\/xpvnsulc\//i.test(urlAfterWait)) {
        await saveBodyText(page, path.join(outDir, 'page.txt'));
        await context.storageState({ path: statePath });
        return {
          attempted: true,
          ok: false,
          status: 'handoff_required',
          handoffRequired: true,
          redirectedToSberId: false,
          bootstrapFailed: false,
          scriptPath: REPO_OWNED_KUPER_BOOTSTRAP,
          statePath,
          outDir,
          finalUrl: urlAfterWait,
          rawStatus: 'anti_bot_challenge',
          errorMessage: 'Anti-bot JS challenge blocked kuper.ru access — IP likely flagged as datacenter'
        };
      }
      throw new Error(`Login button not found: ${(loginBtn as unknown as Error).toString()}`);
    }

    const beforeClickUrl = page.url();
    await Promise.allSettled([
      page.waitForURL(/id\.sber\.ru|kuper\.ru/i, { timeout: 20000 }),
      loginBtn.click({ timeout: 10000 })
    ]);

    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const finalUrl = page.url();
    const text = await saveBodyText(page, path.join(outDir, 'page.txt'));
    await maybeScreenshot(page, path.join(outDir, '02-after-login-click.png'), Boolean(input.debugScreenshots), screenshots);
    await context.storageState({ path: statePath });

    const lowered = text.toLowerCase();
    const redirectedToSberId = /id\.sber\.ru/i.test(finalUrl);
    const maybeAuthenticated =
      /профил|выйти|личный кабинет|мой профиль/i.test(lowered) ||
      (!redirectedToSberId && finalUrl !== beforeClickUrl);
    const stateExists = await fileExists(statePath);

    if (redirectedToSberId) {
      return {
        attempted: true,
        ok: true,
        status: 'redirected_to_sberid',
        handoffRequired: true,
        redirectedToSberId: true,
        bootstrapFailed: false,
        scriptPath: REPO_OWNED_KUPER_BOOTSTRAP,
        statePath,
        outDir,
        finalUrl,
        rawStatus: 'redirected-to-sberid',
        errorMessage: null
      };
    }

    if (maybeAuthenticated) {
      return {
        attempted: true,
        ok: true,
        status: stateExists ? 'state_refreshed' : 'completed_without_auth',
        handoffRequired: false,
        redirectedToSberId: false,
        bootstrapFailed: false,
        scriptPath: REPO_OWNED_KUPER_BOOTSTRAP,
        statePath,
        outDir,
        finalUrl,
        rawStatus: 'maybe-authenticated',
        errorMessage: null
      };
    }

    return {
      attempted: true,
      ok: stateExists,
      status: stateExists ? 'state_refreshed' : 'completed_without_auth',
      handoffRequired: false,
      redirectedToSberId: false,
      bootstrapFailed: !stateExists,
      scriptPath: REPO_OWNED_KUPER_BOOTSTRAP,
      statePath,
      outDir,
      finalUrl,
      rawStatus: finalUrl === beforeClickUrl ? 'loaded' : 'navigated',
      errorMessage: stateExists ? null : 'Bootstrap finished without producing a reusable state file'
    };
  } catch (error) {
    if (page) {
      const errorShot = path.join(outDir, 'error.png');
      await page.screenshot({ path: errorShot, fullPage: true }).catch(() => {});
      if (!screenshots.includes(errorShot)) screenshots.push(errorShot);
    }

    return {
      attempted: true,
      ok: false,
      status: 'failed',
      handoffRequired: false,
      redirectedToSberId: false,
      bootstrapFailed: true,
      scriptPath: REPO_OWNED_KUPER_BOOTSTRAP,
      statePath: input.storageStatePath,
      outDir,
      finalUrl: page?.url() ?? null,
      rawStatus: null,
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  } finally {
    await browser?.close().catch(() => {});
    stopCamoufox?.();
  }
}
