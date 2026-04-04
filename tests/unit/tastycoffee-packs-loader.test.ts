import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDefaultSitePacksRoot, loadSitePack, matchSitePackByUrl } from '../../src/packs/loader.js';

describe('TastyCoffee site pack loader', () => {
  it('loads the TastyCoffee pack from the default site-packs root', async () => {
    const root = path.join(await getDefaultSitePacksRoot(), 'tastycoffee');
    const pack = await loadSitePack(root);

    expect(pack.manifest.site_id).toBe('tastycoffee');
    expect(pack.manifest.support_level).toBe('assisted');
    expect(pack.instructions.summary.length).toBeGreaterThan(0);
    expect(pack.instructions.summary).toContain(
      'Останавливайся перед финальным подтверждением заказа, оплатой и другими необратимыми шагами.'
    );
    expect(pack.hints.pageSignatures.product_page).toEqual(expect.arrayContaining(['Купить', 'В корзину']));
  });

  it('matches the TastyCoffee pack by domain and exposes operational summary', async () => {
    const matched = await matchSitePackByUrl('https://shop.tastycoffee.ru/search?q=espresso');

    expect(matched).not.toBeNull();
    expect(matched?.summary).toMatchObject({
      siteId: 'tastycoffee',
      supportLevel: 'assisted',
      matchedDomain: 'shop.tastycoffee.ru'
    });
    expect(matched?.instructionsSummary.length).toBeGreaterThan(0);
    expect(matched?.knownSignals).toEqual(
      expect.arrayContaining(['home', 'search_results', 'product_page', 'cart', 'auth_form', 'cookie_banner'])
    );
  });
});
