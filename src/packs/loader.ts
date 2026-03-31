import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { access, readdir, readFile } from 'node:fs/promises';
import { buildPackSummary, normalizeManifest, type SitePackManifest, type SitePackSummary } from './manifest.js';
import { parseInstructions, type SitePackInstructions } from './instructions.js';
import { parseHints, type SitePackHints } from './hints.js';

export interface SitePack {
  rootDir: string;
  manifest: SitePackManifest;
  instructions: SitePackInstructions;
  hints: SitePackHints;
}

export interface LoadedSitePack {
  pack: SitePack;
  summary: SitePackSummary;
  instructionsSummary: string[];
  knownSignals: string[];
}

export async function getDefaultSitePacksRoot(): Promise<string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  let current = here;

  while (true) {
    const candidate = path.join(current, 'site-packs');
    try {
      await access(candidate);
      return candidate;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error(`Unable to locate site-packs directory from ${here}`);
      }
      current = parent;
    }
  }
}

export async function loadSitePack(rootDir: string): Promise<SitePack> {
  const [manifestRaw, instructionsRaw, hintsRaw] = await Promise.all([
    readFile(path.join(rootDir, 'manifest.json'), 'utf8'),
    readFile(path.join(rootDir, 'instructions.md'), 'utf8'),
    readFile(path.join(rootDir, 'hints.json'), 'utf8')
  ]);

  return {
    rootDir,
    manifest: normalizeManifest(JSON.parse(manifestRaw) as unknown),
    instructions: parseInstructions(instructionsRaw),
    hints: parseHints(JSON.parse(hintsRaw) as unknown)
  };
}

export async function loadAllSitePacks(sitePacksRoot?: string): Promise<SitePack[]> {
  const resolvedRoot = sitePacksRoot ?? (await getDefaultSitePacksRoot());
  const entries = await readdir(resolvedRoot, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(resolvedRoot, entry.name));
  return Promise.all(dirs.map((dir) => loadSitePack(dir)));
}

export async function matchSitePackByUrl(url: string, sitePacksRoot?: string): Promise<LoadedSitePack | null> {
  const hostname = new URL(url).hostname.toLowerCase();
  const packs = await loadAllSitePacks(sitePacksRoot);
  const matched = packs.find((pack) =>
    pack.manifest.domains.some((domain) => hostname === domain.toLowerCase() || hostname.endsWith(`.${domain.toLowerCase()}`))
  );

  if (!matched) {
    return null;
  }

  const matchedDomain = matched.manifest.domains.find(
    (domain) => hostname === domain.toLowerCase() || hostname.endsWith(`.${domain.toLowerCase()}`)
  ) ?? matched.manifest.domains[0] ?? hostname;

  return {
    pack: matched,
    summary: buildPackSummary(matched.manifest, matchedDomain),
    instructionsSummary: matched.instructions.summary,
    knownSignals: matched.hints.knownSignals
  };
}
