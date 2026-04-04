import { describe, expect, it } from 'vitest';
import { matchSitePackByUrl } from '../../src/packs/loader.js';

describe('TastyCoffee pack operational context', () => {
  it('builds a useful context summary for shop.tastycoffee.ru', async () => {
    const matched = await matchSitePackByUrl('https://shop.tastycoffee.ru/');

    expect(matched).not.toBeNull();
    expect(matched?.summary).toMatchObject({
      siteId: 'tastycoffee',
      supportLevel: 'assisted',
      startUrl: 'https://shop.tastycoffee.ru/'
    });
    expect(matched?.instructionsSummary).toEqual(
      expect.arrayContaining([
        expect.stringContaining('cookie-баннер'),
        expect.stringContaining('финальным подтверждением заказа')
      ])
    );
    expect(matched?.knownSignals).toEqual(
      expect.arrayContaining(['product_page', 'cart', 'auth_form', 'Кофе', 'ПОИСК ТОВАРОВ'])
    );
  });
});
