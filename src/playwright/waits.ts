import type { Page } from 'playwright';

export async function waitForInitialLoad(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(250);
}
