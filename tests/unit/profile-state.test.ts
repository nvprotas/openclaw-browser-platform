import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveProfileForSession } from '../../src/daemon/profile-state.js';

describe('profile-state resolution', () => {
  it('creates a named persistent profile under daemon state root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'browser-platform-profile-'));

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
      storageStateExists: false
    });
    expect(resolved.storageStatePath).toBe(path.join(root, 'profiles', 'camoufox', 'main-profile', 'storage-state.json'));
  });

  it('prefers explicit storage state path over named profile paths', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'browser-platform-profile-'));
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
      source: 'explicit',
      persistent: true
    });
  });
});
