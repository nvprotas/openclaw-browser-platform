import { describe, expect, it } from 'vitest';
import { matchSitePackByUrl } from '../../src/packs/loader.js';

describe('LitRes pack operational context', () => {
  it('builds a useful context summary for litres.ru', async () => {
    const matched = await matchSitePackByUrl('https://www.litres.ru/');

    expect(matched).not.toBeNull();
    expect(matched?.summary).toMatchObject({
      siteId: 'litres',
      supportLevel: 'profiled',
      startUrl: 'https://www.litres.ru/'
    });
    expect(matched?.instructionsSummary).toEqual(
      expect.arrayContaining([
        expect.stringContaining('search field'),
        expect.stringContaining('final payment submission')
      ])
    );
    expect(matched?.knownSignals).toEqual(expect.arrayContaining(['product_page', 'cart', 'В корзину']));
  });
});
