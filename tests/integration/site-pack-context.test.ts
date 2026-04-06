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

  it('собирает полезный context summary для av.ru', async () => {
    const matched = await matchSitePackByUrl('https://av.ru/search?freeText=%D0%BC%D0%BE%D0%BB%D0%BE%D0%BA%D0%BE');

    expect(matched).not.toBeNull();
    expect(matched?.summary).toMatchObject({
      siteId: 'av',
      supportLevel: 'assisted',
      startUrl: 'https://av.ru/'
    });
    expect(matched?.instructionsSummary).toEqual(
      expect.arrayContaining([
        expect.stringContaining('способ получения'),
        expect.stringContaining('challenge/anti-bot')
      ])
    );
    expect(matched?.knownSignals).toEqual(
      expect.arrayContaining(['search_results', 'product_page', 'delivery_gate', 'anti_bot_challenge'])
    );
  });
});
