import { describe, expect, it } from 'vitest';
import { matchSitePackByUrl } from '../../src/packs/loader.js';

describe('Fashionstore pack operational context', () => {
  it('builds a useful context summary for fashionstore.ru', async () => {
    const matched = await matchSitePackByUrl('https://fashionstore.ru/');

    expect(matched).not.toBeNull();
    expect(matched?.summary).toMatchObject({
      siteId: 'fashionstore',
      supportLevel: 'assisted',
      startUrl: 'https://fashionstore.ru/'
    });
    expect(matched?.instructionsSummary).toEqual(
      expect.arrayContaining([
        expect.stringContaining('женском/мужском контексте'),
        expect.stringContaining('финальным подтверждением заказа')
      ])
    );
    expect(matched?.knownSignals).toEqual(
      expect.arrayContaining(['product_page', 'cart', 'login_gate', 'Каталог товаров', 'Добавить в корзину'])
    );
  });
});
