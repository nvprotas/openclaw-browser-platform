import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDefaultSitePacksRoot, loadSitePack, matchSitePackByUrl } from '../../src/packs/loader.js';

describe('Fashionstore site pack loader', () => {
  it('loads the Fashionstore pack from the default site-packs root', async () => {
    const root = path.join(await getDefaultSitePacksRoot(), 'fashionstore');
    const pack = await loadSitePack(root);

    expect(pack.manifest.site_id).toBe('fashionstore');
    expect(pack.manifest.support_level).toBe('assisted');
    expect(pack.instructions.summary.length).toBeGreaterThan(0);
    expect(pack.instructions.summary).toContain(
      'Останавливайся перед финальным подтверждением заказа, оплатой и другими необратимыми шагами.'
    );
    expect(pack.hints.pageSignatures.product_page).toEqual(
      expect.arrayContaining(['Добавить в корзину', 'Купить в один клик', 'Выбрать размер'])
    );
  });

  it('matches the Fashionstore pack by domain and exposes operational summary', async () => {
    const matched = await matchSitePackByUrl('https://fashionstore.ru/catalog/all/?q=bogner');

    expect(matched).not.toBeNull();
    expect(matched?.summary).toMatchObject({
      siteId: 'fashionstore',
      supportLevel: 'assisted',
      matchedDomain: 'fashionstore.ru'
    });
    expect(matched?.instructionsSummary.length).toBeGreaterThan(0);
    expect(matched?.knownSignals).toEqual(
      expect.arrayContaining(['home', 'search_results', 'product_page', 'cart', 'login_gate', 'Каталог товаров'])
    );
  });
});
