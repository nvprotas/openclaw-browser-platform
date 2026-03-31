import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';

export interface SnapshotPaths {
  rootDir: string;
  screenshotPath: string;
  htmlPath: string;
}

export async function capturePageSnapshot(page: Page, snapshotRootDir: string, sessionId: string): Promise<SnapshotPaths> {
  const timestamp = new Date().toISOString().replace(/[.:]/g, '-');
  const rootDir = path.join(snapshotRootDir, sessionId, timestamp);
  await mkdir(rootDir, { recursive: true });

  const screenshotPath = path.join(rootDir, 'page.png');
  const htmlPath = path.join(rootDir, 'page.html');

  await page.screenshot({ path: screenshotPath, fullPage: true });
  await writeFile(htmlPath, await page.content(), 'utf8');

  return { rootDir, screenshotPath, htmlPath };
}
