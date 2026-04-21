export interface SitePackInstructions {
  summary: string[];
  raw: string;
}

export function parseInstructions(markdown: string): SitePackInstructions {
  const summary = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter((line) => line.length > 0);

  return {
    summary,
    raw: markdown
  };
}
