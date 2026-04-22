import { describe, expect, it } from 'vitest';
import {
  buildSearchResultSelectionPlan,
  chooseSearchResultTarget,
  fillSearchAndSubmit,
  findSearchInput
} from '../../src/helpers/search.js';
import { matchSitePackByUrl } from '../../src/packs/loader.js';

describe('search helpers', () => {
  it('derives LitRes search input candidates and submit actions from the pack', async () => {
    const matched = await matchSitePackByUrl('https://www.litres.ru/');
    expect(matched).not.toBeNull();

    const inputs = findSearchInput(matched);
    expect(inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'fill',
          selector: "input[type='search']"
        }),
        expect.objectContaining({
          action: 'fill',
          selector: "[role='combobox']"
        }),
        expect.objectContaining({ action: 'fill', role: 'combobox' })
      ])
    );

    const plan = fillSearchAndSubmit(matched, '1984');
    expect(plan.fillTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'fill',
          selector: "input[name='q']",
          value: '1984'
        })
      ])
    );
    expect(plan.submitTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'click',
          selector: "button[data-testid='search__button']"
        }),
        expect.objectContaining({
          action: 'click',
          role: 'button',
          name: 'Найти'
        })
      ])
    );
  });

  it('picks the most relevant search-result candidate for the query', () => {
    const target = chooseSearchResultTarget(
      {
        pageSignatureGuess: 'search_results',
        visibleTexts: [
          'Результаты поиска',
          'Фильтр',
          'Джордж Оруэлл',
          '1984',
          '1984. Special edition'
        ]
      },
      '1984'
    );

    expect(target).toEqual({
      action: 'click',
      selector: 'a[href*=\'/book/\']:has-text("1984")',
      timeoutMs: 7000
    });
  });

  it('prefers the title token over a generic author token in LitRes results', async () => {
    const matched = await matchSitePackByUrl('https://www.litres.ru/');
    const plan = buildSearchResultSelectionPlan(
      {
        pageSignatureGuess: 'search_results',
        visibleTexts: [
          'Результаты поиска',
          'Илиада',
          'Гомер',
          'Перевод Николай Гнедич',
          '154,90 ₽'
        ]
      },
      'Илиада Гомер текстовая электронная книга',
      matched
    );

    expect(plan.candidates[0]).toMatchObject({ text: 'Илиада' });
    expect(plan.targets[0]).toMatchObject({
      action: 'click',
      selector: expect.stringContaining("a[href*='/book/']:has-text")
    });
    expect(
      plan.targets.some(
        (target) =>
          'selector' in target && /audiobook/i.test(target.selector ?? '')
      )
    ).toBe(false);
    expect(
      plan.targets.map((target) => 'text' in target && target.text)
    ).toContain('Илиада');
  });
});
