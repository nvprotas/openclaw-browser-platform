import type { Page } from 'playwright';

export async function waitForInitialLoad(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await Promise.race([
    page.waitForLoadState('networkidle', { timeout: 3000 }),
    new Promise<void>((resolve) => setTimeout(resolve, 500))
  ]);
}
