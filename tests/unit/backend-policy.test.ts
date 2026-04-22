import { describe, expect, it } from 'vitest';
import type { LoadedSitePack } from '../../src/packs/loader.js';
import { resolveBackendForSession } from '../../src/daemon/backend-policy.js';

function createMatchedPack(domain: string): LoadedSitePack {
  return {
    pack: {
      rootDir: '/tmp/site-pack',
      manifest: {
        site_id: 'test-pack',
        domains: [domain],
        start_url: `https://${domain}`,
        site_type: 'marketplace',
        support_level: 'generic',
        flows: [],
        risk_flags: {}
      },
      instructions: {
        summary: [],
        raw: ''
      },
      hints: {
        pageSignatures: {},
        knownSignals: [],
        raw: {}
      }
    },
    summary: {
      siteId: 'test-pack',
      supportLevel: 'generic',
      matchedDomain: domain,
      startUrl: `https://${domain}`,
      flows: [],
      riskFlags: []
    },
    instructionsSummary: [],
    knownSignals: []
  };
}

describe('resolveBackendForSession', () => {
  it('selects camoufox by default', () => {
    const resolved = resolveBackendForSession({
      requestedUrl: 'https://shop.example.net',
      matchedPack: null
    });

    expect(resolved).toEqual({
      selectedBackend: 'camoufox',
      matchedRule: 'default_camoufox'
    });
  });

  it('selects chromium for allowlisted requested host', () => {
    const resolved = resolveBackendForSession({
      requestedUrl: 'https://example.com/catalog',
      matchedPack: null
    });

    expect(resolved).toEqual({
      selectedBackend: 'chromium',
      matchedRule: 'allowlist_domain_chromium'
    });
  });

  it('selects chromium for litres domain in allowlist', () => {
    const resolved = resolveBackendForSession({
      requestedUrl: 'https://www.litres.ru/books',
      matchedPack: null
    });

    expect(resolved).toEqual({
      selectedBackend: 'chromium',
      matchedRule: 'allowlist_domain_chromium'
    });
  });

  it('selects chromium for brandshop domain in allowlist', () => {
    const resolved = resolveBackendForSession({
      requestedUrl: 'https://brandshop.ru/search/?st=sneakers',
      matchedPack: null
    });

    expect(resolved).toEqual({
      selectedBackend: 'chromium',
      matchedRule: 'allowlist_domain_chromium'
    });
  });

  it('keeps loopback requested hosts on camoufox', () => {
    const resolved = resolveBackendForSession({
      requestedUrl: 'http://127.0.0.1:3000/catalog',
      matchedPack: null
    });

    expect(resolved).toEqual({
      selectedBackend: 'camoufox',
      matchedRule: 'default_camoufox'
    });
  });

  it('keeps loopback matched pack domains on camoufox', () => {
    const resolved = resolveBackendForSession({
      requestedUrl: 'https://books.example.net/catalog',
      matchedPack: createMatchedPack('localhost')
    });

    expect(resolved).toEqual({
      selectedBackend: 'camoufox',
      matchedRule: 'default_camoufox'
    });
  });

  it('selects chromium for allowlisted matched pack domain', () => {
    const resolved = resolveBackendForSession({
      requestedUrl: 'https://books.example.net/catalog',
      matchedPack: createMatchedPack('example.com')
    });

    expect(resolved).toEqual({
      selectedBackend: 'chromium',
      matchedRule: 'allowlist_domain_chromium'
    });
  });

  it('falls back to camoufox for a malformed URL', () => {
    const resolved = resolveBackendForSession({
      requestedUrl: 'not-a-valid-url',
      matchedPack: null
    });

    expect(resolved).toEqual({
      selectedBackend: 'camoufox',
      matchedRule: 'default_camoufox'
    });
  });
});
