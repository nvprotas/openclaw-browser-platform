import type { ClickActionPayload, FillActionPayload, SessionObservation } from '../daemon/types.js';
import type { LoadedSitePack } from '../packs/loader.js';

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function unique<T>(values: T[]): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function readPackStrings(pack: LoadedSitePack | null | undefined, section: string, key: string): string[] {
  const raw = pack?.pack.hints.raw;
  const bucket = raw?.[section];
  if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) {
    return [];
  }

  const values = (bucket as Record<string, unknown>)[key];
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [];
}

export function findSearchInput(pack: LoadedSitePack | null | undefined): FillActionPayload[] {
  const selectors = readPackStrings(pack, 'selectors', 'search_input');
  const selectorTargets = selectors.map<FillActionPayload>((selector) => ({ action: 'fill', selector, value: '' }));

  return [
    ...selectorTargets,
    { action: 'fill', role: 'combobox', value: '' },
    { action: 'fill', role: 'searchbox', value: '' },
    { action: 'fill', role: 'textbox', name: 'Найти', value: '' },
    { action: 'fill', role: 'textbox', name: 'Search', value: '' },
    { action: 'fill', selector: 'input[name="q"]', value: '' }
  ];
}

export function fillSearchAndSubmit(pack: LoadedSitePack | null | undefined, query: string): {
  fillTargets: FillActionPayload[];
  submitTargets: ClickActionPayload[];
} {
  const fillTargets = findSearchInput(pack).map<FillActionPayload>((target) => ({ ...target, value: query }));
  const submitSelectors = readPackStrings(pack, 'selectors', 'search_submit');
  const submitTexts = readPackStrings(pack, 'button_texts', 'search_submit');

  const submitTargets = [
    ...submitSelectors.map<ClickActionPayload>((selector) => ({ action: 'click', selector })),
    ...submitTexts.map<ClickActionPayload>((name) => ({ action: 'click', role: 'button', name })),
    ...submitTexts.map<ClickActionPayload>((text) => ({ action: 'click', text }))
  ];

  return {
    fillTargets: unique(fillTargets),
    submitTargets: unique(submitTargets)
  };
}

function scoreCandidate(candidate: string, query: string): number {
  const normalizedCandidate = normalizeText(candidate);
  const normalizedQuery = normalizeText(query);
  if (!normalizedCandidate || !normalizedQuery) {
    return -1;
  }

  if (normalizedCandidate === normalizedQuery) {
    return 100;
  }

  const candidateTokens = new Set(normalizedCandidate.split(' ').filter(Boolean));
  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  const matchedTokens = queryTokens.filter((token) => candidateTokens.has(token));
  const containsQuery = normalizedCandidate.includes(normalizedQuery);
  const resultWordBonus = /result|results|найден|результат|книга|book/.test(normalizedCandidate) ? 8 : 0;

  return matchedTokens.length * 20 + (containsQuery ? 25 : 0) + resultWordBonus - normalizedCandidate.length / 200;
}

export function chooseSearchResultTarget(
  observation: Pick<SessionObservation, 'visibleTexts' | 'pageSignatureGuess'>,
  query: string
): ClickActionPayload | null {
  if (observation.pageSignatureGuess !== 'search_results') {
    return null;
  }

  const candidates = unique(observation.visibleTexts)
    .filter((text) => text.length >= 2)
    .filter((text) => !/результаты поиска|search results|найдено|найти|поиск|фильтр|filters?/i.test(text))
    .map((text) => ({ text, score: scoreCandidate(text, query) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  const best = candidates[0];
  if (!best) {
    return null;
  }

  return {
    action: 'click',
    text: best.text
  };
}
