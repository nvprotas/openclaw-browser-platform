import { describe, expect, it } from 'vitest';
import { matchSitePackByUrl } from '../../src/packs/loader.js';

describe('Filterix pack operational context', () => {
  it('builds a useful context summary for filterix.ru', async () => {
    const matched = await matchSitePackByUrl('https://filterix.ru/');

    expect(matched).not.toBeNull();
    expect(matched?.summary).toMatchObject({
      siteId: 'filterix',
      supportLevel: 'assisted',
      startUrl: 'https://filterix.ru/'
    });
    expect(matched?.instructionsSummary).toEqual(
      expect.arrayContaining([expect.stringContaining('попап города'), expect.stringContaining('подтверждением заказа')])
    );
    expect(matched?.knownSignals).toEqual(
      expect.arrayContaining(['home', 'search_results', 'product_page', 'cart', 'city_popup', 'Результаты поиска'])
    );
  });
});
