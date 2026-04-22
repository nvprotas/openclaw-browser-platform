import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { LoadedSitePack } from '../packs/loader.js';
import type { SessionBackend } from './types.js';
import { DEFAULT_LITRES_STORAGE_STATE } from './litres-auth.js';

export const DEFAULT_STORAGE_STATE_FRESH_TTL_MS = 60 * 60_000;

export interface ProfileResolution {
  profileId: string | null;
  storageStatePath: string | null;
  storageStateExists: boolean;
  storageStateMtimeMs: number | null;
  storageStateAgeMs: number | null;
  storageStateFresh: boolean;
  source: 'explicit' | 'named' | 'auto_litres' | null;
  persistent: boolean;
}

type StorageStateMetadata = Pick<
  ProfileResolution,
  | 'storageStateExists'
  | 'storageStateMtimeMs'
  | 'storageStateAgeMs'
  | 'storageStateFresh'
>;

function slugifyProfileId(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'default'
  );
}

async function readStorageStateMetadata(
  storageStatePath: string,
  options: {
    nowMs: number;
    freshTtlMs: number;
  }
): Promise<StorageStateMetadata> {
  try {
    const stats = await stat(storageStatePath);
    const storageStateMtimeMs = stats.mtimeMs;
    const storageStateAgeMs = Math.max(0, options.nowMs - storageStateMtimeMs);

    return {
      storageStateExists: true,
      storageStateMtimeMs,
      storageStateAgeMs,
      storageStateFresh: storageStateAgeMs <= options.freshTtlMs
    };
  } catch {
    return {
      storageStateExists: false,
      storageStateMtimeMs: null,
      storageStateAgeMs: null,
      storageStateFresh: false
    };
  }
}

export async function resolveProfileForSession(input: {
  stateRootDir: string;
  backend: SessionBackend;
  requestedUrl: string;
  explicitStorageStatePath?: string;
  profileId?: string;
  matchedPack: LoadedSitePack | null;
  nowMs?: number;
  storageStateFreshTtlMs?: number;
}): Promise<ProfileResolution> {
  const nowMs = input.nowMs ?? Date.now();
  const freshTtlMs =
    input.storageStateFreshTtlMs ?? DEFAULT_STORAGE_STATE_FRESH_TTL_MS;
  const explicitPath = input.explicitStorageStatePath
    ? path.resolve(input.explicitStorageStatePath)
    : null;
  if (explicitPath) {
    const metadata = await readStorageStateMetadata(explicitPath, {
      nowMs,
      freshTtlMs
    });
    return {
      profileId: input.profileId ? slugifyProfileId(input.profileId) : null,
      storageStatePath: explicitPath,
      ...metadata,
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
    const metadata = await readStorageStateMetadata(storageStatePath, {
      nowMs,
      freshTtlMs
    });
    return {
      profileId: normalizedProfileId,
      storageStatePath,
      ...metadata,
      source: 'named',
      persistent: true
    };
  }

  if (input.matchedPack?.summary.siteId === 'litres') {
    const metadata = await readStorageStateMetadata(
      DEFAULT_LITRES_STORAGE_STATE,
      {
        nowMs,
        freshTtlMs
      }
    );
    return {
      profileId: 'litres',
      storageStatePath: DEFAULT_LITRES_STORAGE_STATE,
      ...metadata,
      source: 'auto_litres',
      persistent: true
    };
  }

  return {
    profileId: null,
    storageStatePath: null,
    storageStateExists: false,
    storageStateMtimeMs: null,
    storageStateAgeMs: null,
    storageStateFresh: false,
    source: null,
    persistent: false
  };
}
