export interface SitePackManifest {
  site_id: string;
  domains: string[];
  start_url: string;
  site_type: string;
  support_level: 'generic' | 'profiled' | 'assisted' | 'hardened';
  flows: string[];
  risk_flags: Record<string, boolean>;
}

export interface SitePackSummary {
  siteId: string;
  supportLevel: SitePackManifest['support_level'];
  matchedDomain: string;
  startUrl: string;
  flows: string[];
  riskFlags: string[];
}

export function normalizeManifest(input: unknown): SitePackManifest {
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid site pack manifest: expected object');
  }

  const manifest = input as Record<string, unknown>;
  const siteId = manifest.site_id;
  const domains = manifest.domains;
  const startUrl = manifest.start_url;
  const siteType = manifest.site_type;
  const supportLevel = manifest.support_level;
  const flows = manifest.flows;
  const riskFlags = manifest.risk_flags;

  if (typeof siteId !== 'string' || siteId.length === 0) {
    throw new Error('Invalid site pack manifest: site_id must be a non-empty string');
  }
  if (!Array.isArray(domains) || domains.some((value) => typeof value !== 'string')) {
    throw new Error('Invalid site pack manifest: domains must be a string array');
  }
  if (typeof startUrl !== 'string' || startUrl.length === 0) {
    throw new Error('Invalid site pack manifest: start_url must be a non-empty string');
  }
  if (typeof siteType !== 'string' || siteType.length === 0) {
    throw new Error('Invalid site pack manifest: site_type must be a non-empty string');
  }
  if (!['generic', 'profiled', 'assisted', 'hardened'].includes(String(supportLevel))) {
    throw new Error('Invalid site pack manifest: support_level must be a known value');
  }
  if (!Array.isArray(flows) || flows.some((value) => typeof value !== 'string')) {
    throw new Error('Invalid site pack manifest: flows must be a string array');
  }
  if (!riskFlags || typeof riskFlags !== 'object' || Array.isArray(riskFlags)) {
    throw new Error('Invalid site pack manifest: risk_flags must be an object');
  }

  return {
    site_id: siteId,
    domains: domains as string[],
    start_url: startUrl,
    site_type: siteType,
    support_level: supportLevel as SitePackManifest['support_level'],
    flows: flows as string[],
    risk_flags: riskFlags as Record<string, boolean>
  };
}

export function buildPackSummary(manifest: SitePackManifest, matchedDomain: string): SitePackSummary {
  return {
    siteId: manifest.site_id,
    supportLevel: manifest.support_level,
    matchedDomain,
    startUrl: manifest.start_url,
    flows: [...manifest.flows],
    riskFlags: Object.entries(manifest.risk_flags)
      .filter(([, value]) => value)
      .map(([key]) => key)
  };
}
