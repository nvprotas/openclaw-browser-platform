import type { LoadedSitePack } from '../packs/loader.js';
import type { SessionBackend } from './types.js';

export interface ResolveBackendForSessionInput {
  requestedUrl: string;
  matchedPack: LoadedSitePack | null;
  profileId?: string;
  scenarioId?: string;
}

export interface ResolvedBackendPolicy {
  selectedBackend: SessionBackend;
  matchedRule: 'default_camoufox' | 'allowlist_domain_chromium';
}

const CHROMIUM_ALLOWLIST_DOMAINS = new Set<string>(['example.com', 'litres.ru', 'brandshop.ru']);

function isAllowlistedDomain(hostname: string): boolean {
  return [...CHROMIUM_ALLOWLIST_DOMAINS].some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  );
}

export function resolveBackendForSession(input: ResolveBackendForSessionInput): ResolvedBackendPolicy {
  let hostname: string;
  try {
    hostname = new URL(input.requestedUrl).hostname.toLowerCase();
  } catch {
    return { selectedBackend: 'camoufox', matchedRule: 'default_camoufox' };
  }
  const matchedDomain = input.matchedPack?.summary.matchedDomain?.toLowerCase() ?? null;

  if (isAllowlistedDomain(hostname) || (matchedDomain !== null && isAllowlistedDomain(matchedDomain))) {
    return {
      selectedBackend: 'chromium',
      matchedRule: 'allowlist_domain_chromium'
    };
  }

  return {
    selectedBackend: 'camoufox',
    matchedRule: 'default_camoufox'
  };
}
