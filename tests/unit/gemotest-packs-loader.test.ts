import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDefaultSitePacksRoot, loadSitePack, matchSitePackByUrl } from '../../src/packs/loader.js';

describe('Gemotest site pack loader', () => {
  it('loads the Gemotest pack from the default site-packs root', async () => {
    const root = path.join(await getDefaultSitePacksRoot(), 'gemotest');
    const pack = await loadSitePack(root);

    expect(pack.manifest.site_id).toBe('gemotest');
    expect(pack.manifest.support_level).toBe('assisted');
    expect(pack.instructions.summary.length).toBeGreaterThan(0);
    expect(pack.instructions.summary).toContain(
      'Останавливайся перед финальным подтверждением заказа, оплатой и другими необратимыми шагами.'
    );
    expect(pack.instructions.summary).toContain(
      'На сайте есть скрытые дубли CTA-кнопок, поэтому клики по неуточненным селекторам часто попадают в невидимые элементы.'
    );
    expect(pack.hints.pageSignatures.product_page).toEqual(expect.arrayContaining(['Код на бланке', 'Заказать анализ']));
  });

  it('matches the Gemotest pack by domain and exposes operational summary', async () => {
    const matched = await matchSitePackByUrl('https://gemotest.ru/search/?q=%D1%84%D0%B5%D1%80%D1%80%D0%B8%D1%82%D0%B8%D0%BD');

    expect(matched).not.toBeNull();
    expect(matched?.summary).toMatchObject({
      siteId: 'gemotest',
      supportLevel: 'assisted',
      matchedDomain: 'gemotest.ru'
    });
    expect(matched?.instructionsSummary.length).toBeGreaterThan(0);
    expect(matched?.knownSignals).toEqual(
      expect.arrayContaining(['home', 'search_results', 'product_page', 'cart', 'empty_cart', 'Корзина пуста'])
    );
  });
});
