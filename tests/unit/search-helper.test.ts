import { describe, expect, it } from 'vitest';
import { chooseSearchResultTarget, fillSearchAndSubmit, findSearchInput } from '../../src/helpers/search.js';
import { matchSitePackByUrl } from '../../src/packs/loader.js';

describe('search helpers', () => {
  it('derives LitRes search input candidates and submit actions from the pack', async () => {
    const matched = await matchSitePackByUrl('https://www.litres.ru/');
    expect(matched).not.toBeNull();

    const inputs = findSearchInput(matched);
    expect(inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'fill', selector: "input[type='search']" }),
        expect.objectContaining({ action: 'fill', selector: '[role=\'combobox\']' }),
        expect.objectContaining({ action: 'fill', role: 'combobox' })
      ])
    );

    const plan = fillSearchAndSubmit(matched, '1984');
    expect(plan.fillTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'fill', selector: "input[name='q']", value: '1984' })
      ])
    );
    expect(plan.submitTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'click', selector: "button[data-testid='search__button']" }),
        expect.objectContaining({ action: 'click', role: 'button', name: 'Найти' })
      ])
    );
  });

  it('picks the most relevant search-result candidate for the query', () => {
    const target = chooseSearchResultTarget(
      {
        pageSignatureGuess: 'search_results',
        visibleTexts: ['Результаты поиска', 'Фильтр', 'Джордж Оруэлл', '1984', '1984. Special edition']
      },
      '1984'
    );

    expect(target).toEqual({ action: 'click', text: '1984' });
  });
});
