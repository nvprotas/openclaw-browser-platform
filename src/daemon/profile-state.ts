import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { LoadedSitePack } from '../packs/loader.js';
import type { SessionBackend } from './types.js';
import { DEFAULT_BRANDSHOP_STORAGE_STATE } from './brandshop-auth.js';
import { DEFAULT_LITRES_STORAGE_STATE, fileExists } from './litres-auth.js';

export interface ProfileResolution {
  profileId: string | null;
  storageStatePath: string | null;
  storageStateExists: boolean;
  source: 'explicit' | 'named' | 'auto_litres' | 'auto_brandshop' | null;
  persistent: boolean;
}

function slugifyProfileId(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'default'
  );
}

export async function resolveProfileForSession(input: {
  stateRootDir: string;
  backend: SessionBackend;
  requestedUrl: string;
  explicitStorageStatePath?: string;
  profileId?: string;
  matchedPack: LoadedSitePack | null;
}): Promise<ProfileResolution> {
  const explicitPath = input.explicitStorageStatePath
    ? path.resolve(input.explicitStorageStatePath)
    : null;
  if (explicitPath) {
    return {
      profileId: input.profileId ? slugifyProfileId(input.profileId) : null,
      storageStatePath: explicitPath,
      storageStateExists: await fileExists(explicitPath),
      source: 'explicit',
      persistent: true
    };
  }

  if (input.profileId?.trim()) {
    const normalizedProfileId = slugifyProfileId(input.profileId);
    const profileDir = path.join(
      path.resolve(input.stateRootDir),
      'profiles',
      input.backend,
      normalizedProfileId
    );
    await mkdir(profileDir, { recursive: true });
    const storageStatePath = path.join(profileDir, 'storage-state.json');
    return {
      profileId: normalizedProfileId,
      storageStatePath,
      storageStateExists: await fileExists(storageStatePath),
      source: 'named',
      persistent: true
    };
  }

  if (input.matchedPack?.summary.siteId === 'litres') {
    return {
      profileId: 'litres',
      storageStatePath: DEFAULT_LITRES_STORAGE_STATE,
      storageStateExists: await fileExists(DEFAULT_LITRES_STORAGE_STATE),
      source: 'auto_litres',
      persistent: true
    };
  }

  if (input.matchedPack?.summary.siteId === 'brandshop') {
    return {
      profileId: 'brandshop',
      storageStatePath: DEFAULT_BRANDSHOP_STORAGE_STATE,
      storageStateExists: await fileExists(DEFAULT_BRANDSHOP_STORAGE_STATE),
      source: 'auto_brandshop',
      persistent: true
    };
  }

  return {
    profileId: null,
    storageStatePath: null,
    storageStateExists: false,
    source: null,
    persistent: false
  };
}
