import type {
  ClickActionPayload,
  FillActionPayload,
  SessionObservation
} from '../daemon/types.js';
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

function readPackStrings(
  pack: LoadedSitePack | null | undefined,
  section: string,
  key: string
): string[] {
  const raw = pack?.pack.hints.raw;
  const bucket = raw?.[section];
  if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) {
    return [];
  }

  const values = (bucket as Record<string, unknown>)[key];
  return Array.isArray(values)
    ? values.filter((value): value is string => typeof value === 'string')
    : [];
}

export function findSearchInput(
  pack: LoadedSitePack | null | undefined
): FillActionPayload[] {
  const selectors = readPackStrings(pack, 'selectors', 'search_input');
  const selectorTargets = selectors.map<FillActionPayload>((selector) => ({
    action: 'fill',
    selector,
    value: ''
  }));

  return [
    ...selectorTargets,
    { action: 'fill', role: 'combobox', value: '' },
    { action: 'fill', role: 'searchbox', value: '' },
    { action: 'fill', role: 'textbox', name: 'Найти', value: '' },
    { action: 'fill', role: 'textbox', name: 'Search', value: '' },
    { action: 'fill', selector: 'input[name="q"]', value: '' }
  ];
}

export function fillSearchAndSubmit(
  pack: LoadedSitePack | null | undefined,
  query: string
): {
  fillTargets: FillActionPayload[];
  submitTargets: ClickActionPayload[];
} {
  const fillTargets = findSearchInput(pack).map<FillActionPayload>(
    (target) => ({ ...target, value: query })
  );
  const submitSelectors = readPackStrings(pack, 'selectors', 'search_submit');
  const submitTexts = readPackStrings(pack, 'button_texts', 'search_submit');

  const submitTargets = [
    ...submitSelectors.map<ClickActionPayload>((selector) => ({
      action: 'click',
      selector
    })),
    ...submitTexts.map<ClickActionPayload>((name) => ({
      action: 'click',
      role: 'button',
      name
    })),
    ...submitTexts.map<ClickActionPayload>((text) => ({
      action: 'click',
      text
    }))
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

  const candidateTokens = new Set(
    normalizedCandidate.split(' ').filter(Boolean)
  );
  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  const meaningfulQueryTokens = queryTokens.filter(
    (token) =>
      !/^(?:книг[а-я]*|текстов[а-я]*|электронн[а-я]*|верс(?:ия|ии|ию)|купить|найти|на|литрес)$/.test(
        token
      )
  );
  const matchedTokens = meaningfulQueryTokens.filter((token) =>
    candidateTokens.has(token)
  );
  const containsQuery = normalizedCandidate.includes(normalizedQuery);
  const titleTokenBonus =
    meaningfulQueryTokens[0] && candidateTokens.has(meaningfulQueryTokens[0])
      ? 25
      : 0;
  const genericSingleTokenPenalty =
    candidateTokens.size === 1 &&
    meaningfulQueryTokens.length > 1 &&
    !candidateTokens.has(meaningfulQueryTokens[0])
      ? 10
      : 0;
  const wantsEnglish = /\b(?:английск[а-я]*|english|a1|a2|b1|b2|c1|c2)\b/i.test(
    normalizedQuery
  );
  const wantsPdf = /\bpdf\b/i.test(normalizedQuery);
  const educationalEditionPenalty =
    !wantsEnglish &&
    /английск|english|чтения|оригинале|комментари|адаптированн|\ba[12]\b|\bb[12]\b|\bc[12]\b/.test(
      normalizedCandidate
    )
      ? 35
      : 0;
  const pdfPenalty = !wantsPdf && /\bpdf\b/i.test(normalizedCandidate) ? 25 : 0;

  return (
    matchedTokens.length * 20 +
    (containsQuery ? 25 : 0) +
    titleTokenBonus -
    genericSingleTokenPenalty -
    educationalEditionPenalty -
    pdfPenalty -
    normalizedCandidate.length / 200
  );
}

export interface SearchResultCandidate {
  text: string;
  score: number;
}

export interface SearchResultSelectionPlan {
  candidates: SearchResultCandidate[];
  targets: ClickActionPayload[];
}

function selectorText(value: string): string {
  return JSON.stringify(value.replace(/\s+/g, ' ').trim());
}

function buildSelectorTargets(
  pack: LoadedSitePack | null | undefined,
  candidates: SearchResultCandidate[],
  query: string
): ClickActionPayload[] {
  const includeAudio = /аудио|audiobook|audio|слушать/i.test(
    normalizeText(query)
  );
  const bookLinkSelector = includeAudio
    ? "a[href*='/book/']"
    : "a[href*='/book/']:not([href*='/audiobook/'])";
  const mainBookLinkSelector = includeAudio
    ? "main a[href*='/book/']"
    : "main a[href*='/book/']:not([href*='/audiobook/'])";
  const selectors = readPackStrings(pack, 'selectors', 'search_result_link')
    .filter((selector) => includeAudio || !/audiobook/i.test(selector))
    .map((selector) =>
      !includeAudio && /href\*=['"]\/book\//i.test(selector)
        ? `${selector}:not([href*='/audiobook/'])`
        : selector
    );
  const texts = candidates.slice(0, 3).map((candidate) => candidate.text);

  return unique(
    texts.flatMap((text) => [
      ...selectors.map<ClickActionPayload>((selector) => ({
        action: 'click',
        selector: `${selector}:has-text(${selectorText(text)})`,
        timeoutMs: 7_000
      })),
      {
        action: 'click',
        selector: `${bookLinkSelector}:has-text(${selectorText(text)})`,
        timeoutMs: 7_000
      },
      {
        action: 'click',
        selector: `${mainBookLinkSelector}:has-text(${selectorText(text)})`,
        timeoutMs: 7_000
      }
    ])
  );
}

export function buildSearchResultSelectionPlan(
  observation: Pick<SessionObservation, 'visibleTexts' | 'pageSignatureGuess'>,
  query: string,
  pack?: LoadedSitePack | null
): SearchResultSelectionPlan {
  if (observation.pageSignatureGuess !== 'search_results') {
    return {
      candidates: [],
      targets: []
    };
  }

  const candidates = unique(observation.visibleTexts)
    .filter((text) => text.length >= 2)
    .filter(
      (text) =>
        !/результаты поиска|search results|найдено|найти|поиск|фильтр|filters?/i.test(
          text
        )
    )
    .map((text) => ({ text, score: scoreCandidate(text, query) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  return {
    candidates,
    targets: unique([
      ...buildSelectorTargets(pack, candidates, query),
      ...candidates.slice(0, 5).map<ClickActionPayload>((candidate) => ({
        action: 'click',
        text: candidate.text,
        exact: true,
        timeoutMs: 7_000
      })),
      ...candidates.slice(0, 5).map<ClickActionPayload>((candidate) => ({
        action: 'click',
        text: candidate.text,
        timeoutMs: 7_000
      }))
    ])
  };
}

export function chooseSearchResultTarget(
  observation: Pick<SessionObservation, 'visibleTexts' | 'pageSignatureGuess'>,
  query: string
): ClickActionPayload | null {
  return buildSearchResultSelectionPlan(observation, query).targets[0] ?? null;
}
