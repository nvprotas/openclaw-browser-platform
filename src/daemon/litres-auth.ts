import path from 'node:path';
import type { LoadedSitePack } from '../packs/loader.js';
import { fileExists } from '../playwright/auth-state.js';

const DEFAULT_LITRES_STORAGE_STATE = '/root/.openclaw/workspace/tmp/sberid-login/litres/storage-state.json';

export interface LitresBootstrapResolution {
  storageStatePath: string | null;
  storageStateExists: boolean;
  bootstrapAttempted: boolean;
  bootstrapSource: 'explicit' | 'auto_litres' | null;
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
