import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { inferAuthState } from '../../src/playwright/auth-state.js';
import { resolveStorageStateForSession } from '../../src/daemon/litres-auth.js';

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
