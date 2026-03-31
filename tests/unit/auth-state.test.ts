import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { inferAuthState } from '../../src/playwright/auth-state.js';
import { resolveStorageStateForSession, runIntegratedLitresBootstrap } from '../../src/daemon/litres-auth.js';
import { matchSitePackByUrl } from '../../src/packs/loader.js';

describe('auth state inference', () => {
  it('detects authenticated signals', () => {
    const state = inferAuthState('https://www.litres.ru/account', {
      url: 'https://www.litres.ru/account',
      title: 'Account',
      readyState: 'complete',
      viewport: { width: 1440, height: 900 },
      visibleTexts: ['Профиль', 'Мои книги'],
      visibleButtons: [{ text: 'Выйти', role: 'button', type: 'button', ariaLabel: null }],
      forms: [],
      pageSignatureGuess: 'content_page'
    });

    expect(state.state).toBe('authenticated');
    expect(state.authenticatedSignals).toEqual(expect.arrayContaining(['visible_my_books', 'visible_logout']));
  });

  it('detects login gate', () => {
    const state = inferAuthState('https://www.litres.ru/auth/login/', {
      url: 'https://www.litres.ru/auth/login/',
      title: 'Login',
      readyState: 'complete',
      viewport: { width: 1440, height: 900 },
      visibleTexts: ['Войти', 'Пароль'],
      visibleButtons: [{ text: 'Войти', role: 'button', type: 'submit', ariaLabel: null }],
      forms: [{ id: null, name: null, method: 'post', action: '/auth/login', inputCount: 2, submitLabels: ['Войти'] }],
      pageSignatureGuess: 'auth_form'
    });

    expect(state.state).toBe('login_gate_detected');
    expect(state.loginGateDetected).toBe(true);
  });
});

describe('LitRes storage-state resolution', () => {
  it('prefers explicit storage state path when provided', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'browser-platform-auth-test-'));
    const storageStatePath = path.join(dir, 'storage-state.json');
    await writeFile(storageStatePath, '{"cookies":[],"origins":[]}\n', 'utf8');

    const resolved = await resolveStorageStateForSession({
      requestedUrl: 'https://www.litres.ru/',
      explicitStorageStatePath: storageStatePath,
      matchedPack: null
    });

    expect(resolved).toMatchObject({
      storageStatePath,
      storageStateExists: true,
      bootstrapAttempted: true,
      bootstrapSource: 'explicit'
    });
  });
});

describe('integrated LitRes bootstrap', () => {
  it('returns not_applicable for non-LitRes packs', async () => {
    const result = await runIntegratedLitresBootstrap({
      matchedPack: null,
      storageStatePath: null
    });

    expect(result.status).toBe('not_applicable');
    expect(result.attempted).toBe(false);
  });

  it('reports missing cookies without hanging on a real login attempt', async () => {
    const matchedPack = await matchSitePackByUrl('https://www.litres.ru/');
    const result = await runIntegratedLitresBootstrap({
      matchedPack,
      storageStatePath: path.join(os.tmpdir(), 'browser-platform-missing-state.json'),
      cookiesPath: path.join(os.tmpdir(), 'definitely-missing-sber-cookies.json')
    });

    expect(result.attempted).toBe(true);
    expect(result.scriptPath).toBe('repo:src/daemon/litres-auth.ts');
    expect(result.statePath).toContain('browser-platform-missing-state.json');
    expect(result.status).toBe('skipped_missing_cookies');
    expect(result.bootstrapFailed).toBe(true);
  });
});
