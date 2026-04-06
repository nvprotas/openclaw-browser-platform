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

  it('загружает pack av.ru из стандартного каталога site-packs', async () => {
    const root = path.join(await getDefaultSitePacksRoot(), 'av');
    const pack = await loadSitePack(root);

    expect(pack.manifest.site_id).toBe('av');
    expect(pack.manifest.support_level).toBe('assisted');
    expect(pack.instructions.summary).toContain(
      'Если runtime попал на challenge/anti-bot страницу под `av.ru` с пустым контентом или длинным служебным URL, остановись и сообщи о gate вместо слепого ретрая.'
    );
    expect(pack.hints.pageSignatures.product_page).toContain('Добавить в корзину');
  });

  it('матчит pack av.ru по домену и challenge URL', async () => {
    const matched = await matchSitePackByUrl(
      'https://av.ru/xpvnsulc/?back_location=https%3A%2F%2Fav.ru%2F&hcheck=abc123&request_id=req-1'
    );

    expect(matched).not.toBeNull();
    expect(matched?.summary).toMatchObject({
      siteId: 'av',
      supportLevel: 'assisted',
      matchedDomain: 'av.ru'
    });
    expect(matched?.instructionsSummary.length).toBeGreaterThan(0);
    expect(matched?.knownSignals).toEqual(
      expect.arrayContaining(['search_results', 'product_page', 'delivery_gate', 'anti_bot_challenge'])
    );
  });
});
