import { afterEach, describe, expect, it, vi } from 'vitest';

describe('site pack cache', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('node:fs/promises');
  });

  it('reuses loaded site-packs across repeated URL matches for the same root', async () => {
    vi.resetModules();
    const readFile = vi.fn(async (filePath: string) => {
      if (filePath.endsWith('manifest.json')) {
        return JSON.stringify({
          site_id: 'litres',
          domains: ['litres.ru'],
          start_url: 'https://www.litres.ru/',
          site_type: 'ebook_store',
          support_level: 'profiled',
          flows: ['search'],
          risk_flags: {}
        });
      }

      if (filePath.endsWith('instructions.md')) {
        return '- Use LitRes\n';
      }

      if (filePath.endsWith('hints.json')) {
        return JSON.stringify({ page_signatures: { home: ['Каталог'] } });
      }

      throw new Error(`Unexpected file path: ${filePath}`);
    });

    vi.doMock('node:fs/promises', () => ({
      access: vi.fn(async () => undefined),
      readdir: vi.fn(async () => [{ name: 'litres', isDirectory: () => true }]),
      readFile
    }));

    const { clearSitePackCache, matchSitePackByUrl } =
      await import('../../src/packs/loader.js');
    clearSitePackCache();

    await expect(
      matchSitePackByUrl('https://www.litres.ru/book/1', '/packs')
    ).resolves.toMatchObject({
      summary: { siteId: 'litres' }
    });
    await expect(
      matchSitePackByUrl('https://www.litres.ru/search/?q=1', '/packs')
    ).resolves.toMatchObject({
      summary: { siteId: 'litres' }
    });

    expect(readFile).toHaveBeenCalledTimes(3);
  });
});
