export interface SitePackHints {
  pageSignatures: Record<string, string[]>;
  knownSignals: string[];
  raw: Record<string, unknown>;
}

export function parseHints(input: unknown): SitePackHints {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const pageSignatures =
    raw.page_signatures && typeof raw.page_signatures === 'object' && !Array.isArray(raw.page_signatures)
      ? Object.fromEntries(
          Object.entries(raw.page_signatures as Record<string, unknown>).map(([key, value]) => [
            key,
            Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
          ])
        )
      : {};

  const knownSignals = [
    ...Object.keys(pageSignatures),
    ...Object.values(pageSignatures).flatMap((signals) => signals)
  ].slice(0, 16);

  return {
    pageSignatures,
    knownSignals,
    raw
  };
}
