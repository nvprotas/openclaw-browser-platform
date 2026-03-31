import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import type { Page } from 'playwright';
import type { LoadedSitePack } from '../packs/loader.js';

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
}

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
  if (input.matchedPack?.summary.siteId !== 'litres') {
    return {
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
      errorMessage: null
    };
  }

  const cookiesPath = path.resolve(input.cookiesPath ?? DEFAULT_SBER_COOKIES_PATH);
  const outDir = path.resolve(input.outDir ?? DEFAULT_LITRES_BOOTSTRAP_OUT_DIR);
  if (!(await fileExists(cookiesPath))) {
    return {
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
      errorMessage: 'Sber cookies file is missing'
    };
  }

  const statePath = path.resolve(input.storageStatePath ?? DEFAULT_LITRES_STORAGE_STATE);
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

  const browser = await chromium.launch({ headless: !input.headed });
  const reusedSavedState = await fileExists(statePath);
  const context = reusedSavedState
    ? await browser.newContext({ viewport: { width: 1440, height: 1200 }, storageState: statePath })
    : await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const page = await context.newPage();

  try {
    await context.addCookies(cookies as Parameters<typeof context.addCookies>[0]);
    await context.storageState({ path: statePath });

    await page.goto(DEFAULT_LITRES_BOOTSTRAP_ENTRY_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(1500);
    await maybeScreenshot(page, path.join(outDir, '01-login-page.png'), Boolean(input.debugScreenshots), screenshots);

    const otherWays = page.locator('text=Другие способы').first();
    await otherWays.waitFor({ state: 'visible', timeout: 30000 });
    await otherWays.click({ timeout: 30000 });
    await page.waitForTimeout(1500);
    await maybeScreenshot(page, path.join(outDir, '02-other-ways.png'), Boolean(input.debugScreenshots), screenshots);

    const sberIcon = page.locator('img[alt="sb"]').first();
    await sberIcon.waitFor({ state: 'visible', timeout: 30000 });

    const beforeClickUrl = page.url();
    await Promise.allSettled([
      page.waitForURL(/id\.sber\.ru|callbacks\/social-auth|litres\.ru/i, { timeout: 20000 }),
      sberIcon.click({ timeout: 10000 })
    ]);

    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const finalUrl = page.url();
    const text = await saveBodyText(page, path.join(outDir, 'page.txt'));
    await maybeScreenshot(page, path.join(outDir, '03-after-sber-click.png'), Boolean(input.debugScreenshots), screenshots);
    await context.storageState({ path: statePath });

    const lowered = text.toLowerCase();
    const redirectedToSberId = /id\.sber\.ru/i.test(finalUrl);
    const maybeAuthenticated = /callbacks\/social-auth/i.test(finalUrl) || /выйти|профиль|аккаунт|мой кабинет/i.test(lowered);
    const stateExists = await fileExists(statePath);

    if (redirectedToSberId) {
      return {
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
        scriptPath: REPO_OWNED_LITRES_BOOTSTRAP,
        statePath,
        outDir,
        finalUrl,
        rawStatus: finalUrl.includes('/callbacks/social-auth') ? 'litres-callback' : 'maybe-authenticated',
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
      scriptPath: REPO_OWNED_LITRES_BOOTSTRAP,
      statePath,
      outDir,
      finalUrl: finalUrl === beforeClickUrl ? finalUrl : finalUrl,
      rawStatus: finalUrl === beforeClickUrl ? 'loaded' : 'navigated',
      errorMessage: stateExists ? null : 'Bootstrap finished without producing a reusable state file'
    };
  } catch (error) {
    const errorShot = path.join(outDir, 'error.png');
    await page.screenshot({ path: errorShot, fullPage: true }).catch(() => {});
    if (!screenshots.includes(errorShot)) screenshots.push(errorShot);

    return {
      attempted: true,
      ok: false,
      status: 'failed',
      handoffRequired: false,
      redirectedToSberId: false,
      bootstrapFailed: true,
      scriptPath: REPO_OWNED_LITRES_BOOTSTRAP,
      statePath,
      outDir,
      finalUrl: page.url(),
      rawStatus: null,
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  } finally {
    await browser.close();
  }
}
