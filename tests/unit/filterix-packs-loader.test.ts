import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDefaultSitePacksRoot, loadSitePack, matchSitePackByUrl } from '../../src/packs/loader.js';

describe('Filterix site pack loader', () => {
  it('loads the Filterix pack from the default site-packs root', async () => {
    const root = path.join(await getDefaultSitePacksRoot(), 'filterix');
    const pack = await loadSitePack(root);

    expect(pack.manifest.site_id).toBe('filterix');
    expect(pack.manifest.support_level).toBe('assisted');
    expect(pack.instructions.summary.length).toBeGreaterThan(0);
    expect(pack.instructions.summary).toContain(
      'Останавливайся перед финальным подтверждением заказа, оплатой и другими необратимыми шагами.'
    );
    expect(pack.hints.pageSignatures.product_page).toEqual(expect.arrayContaining(['В корзину', 'В корзине']));
  });

  it('matches the Filterix pack by domain and exposes operational summary', async () => {
    const matched = await matchSitePackByUrl('https://filterix.ru/poisk/?q=dreame');

    expect(matched).not.toBeNull();
    expect(matched?.summary).toMatchObject({
      siteId: 'filterix',
      supportLevel: 'assisted',
      matchedDomain: 'filterix.ru'
    });
    expect(matched?.instructionsSummary.length).toBeGreaterThan(0);
    expect(matched?.knownSignals).toEqual(
      expect.arrayContaining(['home', 'search_results', 'product_page', 'cart', 'city_popup'])
    );
  });
});
