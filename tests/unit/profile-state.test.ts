import { mkdtemp, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STORAGE_STATE_FRESH_TTL_MS,
  resolveProfileForSession
} from '../../src/daemon/profile-state.js';

describe('profile-state resolution', () => {
  it('creates a named persistent profile under daemon state root', async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), 'browser-platform-profile-')
    );

    const resolved = await resolveProfileForSession({
      stateRootDir: root,
      backend: 'camoufox',
      requestedUrl: 'https://example.com',
      profileId: 'Main Profile',
      matchedPack: null
    });

    expect(resolved).toMatchObject({
      profileId: 'main-profile',
      source: 'named',
      persistent: true,
      storageStateExists: false,
      storageStateMtimeMs: null,
      storageStateAgeMs: null,
      storageStateFresh: false
    });
    expect(resolved.storageStatePath).toBe(
      path.join(
        root,
        'profiles',
        'camoufox',
        'main-profile',
        'storage-state.json'
      )
    );
  });

  it('prefers explicit storage state path over named profile paths', async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), 'browser-platform-profile-')
    );
    const explicitPath = path.join(root, 'custom-state.json');
    await writeFile(explicitPath, '{"cookies":[],"origins":[]}\n', 'utf8');

    const resolved = await resolveProfileForSession({
      stateRootDir: root,
      backend: 'camoufox',
      requestedUrl: 'https://example.com',
      explicitStorageStatePath: explicitPath,
      profileId: 'ignored-name',
      matchedPack: null
    });

    expect(resolved).toMatchObject({
      profileId: 'ignored-name',
      storageStatePath: explicitPath,
      storageStateExists: true,
      storageStateFresh: true,
      source: 'explicit',
      persistent: true
    });
    expect(resolved.storageStateMtimeMs).toBeTypeOf('number');
    expect(resolved.storageStateAgeMs).toBeGreaterThanOrEqual(0);
  });

  it('marks an existing storage-state stale after the default TTL', async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), 'browser-platform-profile-')
    );
    const explicitPath = path.join(root, 'stale-state.json');
    await writeFile(explicitPath, '{"cookies":[],"origins":[]}\n', 'utf8');

    const staleMtimeMs =
      Date.now() - DEFAULT_STORAGE_STATE_FRESH_TTL_MS - 10_000;
    const staleDate = new Date(staleMtimeMs);
    await utimes(explicitPath, staleDate, staleDate);

    const resolved = await resolveProfileForSession({
      stateRootDir: root,
      backend: 'camoufox',
      requestedUrl: 'https://example.com',
      explicitStorageStatePath: explicitPath,
      matchedPack: null,
      nowMs: Date.now()
    });

    expect(resolved).toMatchObject({
      storageStateExists: true,
      storageStateFresh: false
    });
    expect(resolved.storageStateAgeMs).toBeGreaterThan(
      DEFAULT_STORAGE_STATE_FRESH_TTL_MS
    );
  });

  it('reports missing explicit storage-state without freshness metadata', async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), 'browser-platform-profile-')
    );
    const explicitPath = path.join(root, 'missing-state.json');

    const resolved = await resolveProfileForSession({
      stateRootDir: root,
      backend: 'camoufox',
      requestedUrl: 'https://example.com',
      explicitStorageStatePath: explicitPath,
      matchedPack: null
    });

    expect(resolved).toMatchObject({
      storageStatePath: explicitPath,
      storageStateExists: false,
      storageStateMtimeMs: null,
      storageStateAgeMs: null,
      storageStateFresh: false
    });
  });
});
