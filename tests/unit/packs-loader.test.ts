import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDefaultSitePacksRoot, loadSitePack, matchSitePackByUrl } from '../../src/packs/loader.js';

describe('site pack loader', () => {
  it('loads the LitRes pack from the default site-packs root', async () => {
    const root = path.join(await getDefaultSitePacksRoot(), 'litres');
    const pack = await loadSitePack(root);

    expect(pack.manifest.site_id).toBe('litres');
    expect(pack.manifest.support_level).toBe('profiled');
    expect(pack.instructions.summary).toContain('Stop before any final payment submission or any sensitive authentication step that requires fresh human involvement.');
    expect(pack.hints.pageSignatures.product_page).toContain('В корзину');
  });

  it('matches the LitRes pack by domain and exposes operational summary', async () => {
    const matched = await matchSitePackByUrl('https://www.litres.ru/search/?q=1984');

    expect(matched).not.toBeNull();
    expect(matched?.summary).toMatchObject({
      siteId: 'litres',
      supportLevel: 'profiled',
      matchedDomain: 'litres.ru'
    });
    expect(matched?.instructionsSummary.length).toBeGreaterThan(0);
    expect(matched?.knownSignals).toEqual(expect.arrayContaining(['home', 'search_results', 'product_page', 'cart']));
  });
});
