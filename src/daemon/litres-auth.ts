import { access } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { LoadedSitePack } from '../packs/loader.js';

const execFileAsync = promisify(execFile);

export const DEFAULT_LITRES_STORAGE_STATE = '/root/.openclaw/workspace/tmp/sberid-login/litres/storage-state.json';
export const DEFAULT_LITRES_LOGIN_SCRIPT =
  '/root/.openclaw/workspace/skills/litres-sberid-login/scripts/litres-login.js';
export const DEFAULT_SBER_COOKIES_PATH = '/root/.openclaw/workspace/sber-cookies.json';
export const DEFAULT_LITRES_BOOTSTRAP_OUT_DIR = '/root/.openclaw/workspace/tmp/sberid-login/litres';

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
    | 'skipped_missing_script'
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

interface LitresLoginScriptJson {
  ok?: boolean;
  status?: string;
  finalUrl?: string;
  statePath?: string;
  outDir?: string;
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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
  scriptPath?: string;
  cookiesPath?: string;
  outDir?: string;
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

  const scriptPath = path.resolve(input.scriptPath ?? DEFAULT_LITRES_LOGIN_SCRIPT);
  const cookiesPath = path.resolve(input.cookiesPath ?? DEFAULT_SBER_COOKIES_PATH);
  const outDir = path.resolve(input.outDir ?? DEFAULT_LITRES_BOOTSTRAP_OUT_DIR);
  if (!(await fileExists(scriptPath))) {
    return {
      attempted: true,
      ok: false,
      status: 'skipped_missing_script',
      handoffRequired: false,
      redirectedToSberId: false,
      bootstrapFailed: true,
      scriptPath,
      statePath: input.storageStatePath,
      outDir,
      finalUrl: null,
      rawStatus: null,
      errorMessage: 'LitRes login bootstrap script is missing'
    };
  }

  if (!(await fileExists(cookiesPath))) {
    return {
      attempted: true,
      ok: false,
      status: 'skipped_missing_cookies',
      handoffRequired: false,
      redirectedToSberId: false,
      bootstrapFailed: true,
      scriptPath,
      statePath: input.storageStatePath,
      outDir,
      finalUrl: null,
      rawStatus: null,
      errorMessage: 'Sber cookies file is missing'
    };
  }

  const statePath = path.resolve(input.storageStatePath ?? DEFAULT_LITRES_STORAGE_STATE);

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      scriptPath,
      '--cookies',
      cookiesPath,
      '--out-dir',
      outDir,
      '--state',
      statePath
    ]);

    const parsed = JSON.parse(stdout.trim()) as LitresLoginScriptJson;
    const rawStatus = parsed.status ?? null;
    const finalUrl = parsed.finalUrl ?? null;
    const stateExists = await fileExists(statePath);

    if (rawStatus === 'redirected-to-sberid') {
      return {
        attempted: true,
        ok: true,
        status: 'redirected_to_sberid',
        handoffRequired: true,
        redirectedToSberId: true,
        bootstrapFailed: false,
        scriptPath,
        statePath,
        outDir: parsed.outDir ?? outDir,
        finalUrl,
        rawStatus,
        errorMessage: null
      };
    }

    if (rawStatus === 'litres-callback' || rawStatus === 'maybe-authenticated') {
      return {
        attempted: true,
        ok: true,
        status: stateExists ? 'state_refreshed' : 'completed_without_auth',
        handoffRequired: false,
        redirectedToSberId: false,
        bootstrapFailed: false,
        scriptPath,
        statePath,
        outDir: parsed.outDir ?? outDir,
        finalUrl,
        rawStatus,
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
      scriptPath,
      statePath,
      outDir: parsed.outDir ?? outDir,
      finalUrl,
      rawStatus,
      errorMessage: stateExists ? null : 'Bootstrap finished without producing a reusable state file'
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      status: 'failed',
      handoffRequired: false,
      redirectedToSberId: false,
      bootstrapFailed: true,
      scriptPath,
      statePath,
      outDir,
      finalUrl: null,
      rawStatus: null,
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  }
}
