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

  it('selects chromium for allowlisted matched pack domain', () => {
    const resolved = resolveBackendForSession({
      requestedUrl: 'https://books.example.net/catalog',
      matchedPack: createMatchedPack('localhost')
    });

    expect(resolved).toEqual({
      selectedBackend: 'chromium',
      matchedRule: 'allowlist_domain_chromium'
    });
  });
});
