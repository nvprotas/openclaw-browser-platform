import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyBrandshopBootstrapPage,
  runIntegratedBrandshopBootstrap
} from '../../src/daemon/brandshop-auth.js';
import {
  classifyLitresBootstrapPage,
  resolveStorageStateForSession,
  runIntegratedLitresBootstrap
} from '../../src/daemon/litres-auth.js';
import { createEmptyPaymentContext } from '../../src/helpers/payment-context.js';
import { matchSitePackByUrl } from '../../src/packs/loader.js';
import { inferAuthState } from '../../src/playwright/auth-state.js';

describe('auth state inference', () => {
  it('detects authenticated signals', () => {
    const state = inferAuthState('https://www.litres.ru/account', {
      url: 'https://www.litres.ru/account',
      title: 'Account',
      readyState: 'complete',
      viewport: { width: 1440, height: 900 },
      visibleTexts: ['Профиль', 'Личный кабинет'],
      visibleButtons: [
        { text: 'Выйти', role: 'button', type: 'button', ariaLabel: null }
      ],
      forms: [],
      urlHints: [],
      pageSignatureGuess: 'content_page',
      paymentContext: createEmptyPaymentContext()
    });

    expect(state.state).toBe('authenticated');
    expect(state.authenticatedSignals).toEqual(
      expect.arrayContaining([
        'visible_profile',
        'visible_cabinet',
        'visible_logout'
      ])
    );
  });

  it('detects login gate', () => {
    const state = inferAuthState('https://www.litres.ru/auth/login/', {
      url: 'https://www.litres.ru/auth/login/',
      title: 'Login',
      readyState: 'complete',
      viewport: { width: 1440, height: 900 },
      visibleTexts: ['Войти', 'Пароль'],
      visibleButtons: [
        { text: 'Войти', role: 'button', type: 'submit', ariaLabel: null }
      ],
      forms: [
        {
          id: null,
          name: null,
          method: 'post',
          action: '/auth/login',
          inputCount: 2,
          submitLabels: ['Войти']
        }
      ],
      urlHints: [],
      pageSignatureGuess: 'auth_form',
      paymentContext: createEmptyPaymentContext()
    });

    expect(state.state).toBe('login_gate_detected');
    expect(state.loginGateDetected).toBe(true);
  });

  it('treats Sber ID handoff page as login gate', () => {
    const state = inferAuthState('https://id.sber.ru/auth/realms/root', {
      url: 'https://id.sber.ru/auth/realms/root',
      title: 'Sber ID',
      readyState: 'complete',
      viewport: { width: 1440, height: 900 },
      visibleTexts: ['Сбер ID', 'Продолжить'],
      visibleButtons: [
        { text: 'Продолжить', role: 'button', type: 'button', ariaLabel: null }
      ],
      forms: [],
      urlHints: [],
      pageSignatureGuess: 'content_page',
      paymentContext: createEmptyPaymentContext()
    });

    expect(state.state).toBe('login_gate_detected');
    expect(state.loginGateDetected).toBe(true);
  });

  it('treats LitRes auth_proxy as intermediate login gate even with account hints', () => {
    const state = inferAuthState(
      'https://www.litres.ru/auth_proxy/?origin=https%3A%2F%2Fwww.litres.ru',
      {
        url: 'https://www.litres.ru/auth_proxy/?origin=https%3A%2F%2Fwww.litres.ru',
        title: 'Auth proxy',
        readyState: 'complete',
        viewport: { width: 1440, height: 900 },
        visibleTexts: ['Мои книги', 'Переход выполняется'],
        visibleButtons: [
          { text: 'Войти', role: 'button', type: 'button', ariaLabel: null }
        ],
        forms: [],
        urlHints: [],
        pageSignatureGuess: 'content_page',
        paymentContext: createEmptyPaymentContext()
      }
    );

    expect(state.state).toBe('login_gate_detected');
    expect(state.authenticatedSignals).toEqual([]);
    expect(state.anonymousSignals).toContain('visible_login');
  });

  it('treats LitRes callback page as intermediate login gate', () => {
    const state = inferAuthState(
      'https://www.litres.ru/callbacks/social-auth?provider=sb',
      {
        url: 'https://www.litres.ru/callbacks/social-auth?provider=sb',
        title: 'Callback',
        readyState: 'complete',
        viewport: { width: 1440, height: 900 },
        visibleTexts: ['Подождите, выполняется вход'],
        visibleButtons: [],
        forms: [],
        urlHints: [],
        pageSignatureGuess: 'content_page',
        paymentContext: createEmptyPaymentContext()
      }
    );

    expect(state.state).toBe('login_gate_detected');
  });
});

describe('LitRes storage-state resolution', () => {
  it('prefers explicit storage state path when provided', async () => {
    const dir = await mkdtemp(
      path.join(os.tmpdir(), 'browser-platform-auth-test-')
    );
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
      storageStatePath: path.join(
        os.tmpdir(),
        'browser-platform-missing-state.json'
      ),
      cookiesPath: path.join(
        os.tmpdir(),
        'definitely-missing-sber-cookies.json'
      )
    });

    expect(result.attempted).toBe(true);
    expect(result.scriptPath).toBe('repo:src/daemon/litres-auth.ts');
    expect(result.statePath).toContain('browser-platform-missing-state.json');
    expect(result.status).toBe('skipped_missing_cookies');
    expect(result.bootstrapFailed).toBe(true);
    expect(result.durationMs).toBeTypeOf('number');
    expect(result.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: 'check_cookies_file',
          status: 'ok'
        })
      ])
    );
  });

  it('classifies intermediate LitRes auth pages as non-final', () => {
    expect(
      classifyLitresBootstrapPage({
        url: 'https://www.litres.ru/auth_proxy/?origin=https%3A%2F%2Fwww.litres.ru&network=sb',
        bodyText: 'Мои книги Войти'
      })
    ).toBe('intermediate_auth');

    expect(
      classifyLitresBootstrapPage({
        url: 'https://www.litres.ru/callbacks/social-auth?provider=sb',
        bodyText: 'Переадресация после входа'
      })
    ).toBe('intermediate_auth');
  });

  it('classifies handoff and authenticated LitRes pages separately', () => {
    expect(
      classifyLitresBootstrapPage({
        url: 'https://id.sber.ru/auth/realms/root',
        bodyText: 'Сбер ID'
      })
    ).toBe('handoff_sberid');

    expect(
      classifyLitresBootstrapPage({
        url: 'https://www.litres.ru/pages/biblio_book/?art=123',
        bodyText: 'Мои книги Профиль Выйти'
      })
    ).toBe('authenticated_litres');
  });
});

describe('integrated Brandshop bootstrap', () => {
  it('returns not_applicable for non-Brandshop packs', async () => {
    const result = await runIntegratedBrandshopBootstrap({
      matchedPack: null,
      storageStatePath: null
    });

    expect(result.status).toBe('not_applicable');
    expect(result.attempted).toBe(false);
  });

  it('reports missing cookies without hanging on a real login attempt', async () => {
    const matchedPack = await matchSitePackByUrl('https://brandshop.ru/');
    const result = await runIntegratedBrandshopBootstrap({
      matchedPack,
      storageStatePath: path.join(
        os.tmpdir(),
        'browser-platform-brandshop-missing-state.json'
      ),
      cookiesPath: path.join(
        os.tmpdir(),
        'definitely-missing-sber-cookies.json'
      )
    });

    expect(result.attempted).toBe(true);
    expect(result.scriptPath).toBe('repo:src/daemon/brandshop-auth.ts');
    expect(result.status).toBe('skipped_missing_cookies');
    expect(result.bootstrapFailed).toBe(true);
    expect(result.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: 'check_cookies_file',
          status: 'ok'
        })
      ])
    );
  });

  it('classifies Brandshop auth callback and handoff pages separately', () => {
    expect(
      classifyBrandshopBootstrapPage({
        url: 'https://api.brandshop.ru/xhr/checkout/sber_id/callback?code=abc',
        bodyText: 'Redirecting'
      })
    ).toBe('intermediate_callback');

    expect(
      classifyBrandshopBootstrapPage({
        url: 'https://id.sber.ru/auth/realms/root',
        bodyText: 'Sber ID'
      })
    ).toBe('handoff_sberid');
  });
});
