import { describe, expect, it, vi } from 'vitest';
import {
  buildSizeSelectionObservation,
  selectFirstAvailableSize
} from '../../src/helpers/size-select.js';

describe('size selection helper', () => {
  it('reports selected available size', async () => {
    const page = {
      evaluate: vi.fn(async () => ({
        status: 'selected',
        text: '42',
        selector: '#size-42'
      }))
    };

    const result = await selectFirstAvailableSize({
      page: vi.fn(() => page)
    } as never);

    expect(result).toEqual({
      status: 'selected',
      text: '42',
      selector: '#size-42'
    });
    expect(buildSizeSelectionObservation(result)).toMatchObject({
      level: 'info',
      code: 'SIZE_SELECTED'
    });
  });

  it('warns when size selection is required but no size is available', () => {
    expect(
      buildSizeSelectionObservation({
        status: 'not_found',
        text: null,
        selector: null
      })
    ).toMatchObject({
      level: 'warning',
      code: 'SIZE_SELECTION_REQUIRED'
    });
  });
});
