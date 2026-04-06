import { describe, expect, it } from 'vitest';
import { matchSitePackByUrl } from '../../src/packs/loader.js';

describe('Gemotest pack operational context', () => {
  it('builds a useful context summary for gemotest.ru', async () => {
    const matched = await matchSitePackByUrl('https://gemotest.ru/');

    expect(matched).not.toBeNull();
    expect(matched?.summary).toMatchObject({
      siteId: 'gemotest',
      supportLevel: 'assisted',
      startUrl: 'https://gemotest.ru/'
    });
    expect(matched?.instructionsSummary).toEqual(
      expect.arrayContaining([
        expect.stringContaining('подтверждение города'),
        expect.stringContaining('выбор отделения'),
        expect.stringContaining('финальным подтверждением заказа')
      ])
    );
    expect(matched?.knownSignals).toEqual(
      expect.arrayContaining(['home', 'search_results', 'product_page', 'cart', 'empty_cart', 'Оформление заказа'])
    );
  });
});
