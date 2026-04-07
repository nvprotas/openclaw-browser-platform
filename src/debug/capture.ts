import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';

export function isDebugEnabled(): boolean {
  return process.env['BROWSER_PLATFORM_DEBUG'] === '1';
}

export async function captureDebugStepJson(
  rootDir: string,
  sessionId: string,
  stepName: string,
  meta: unknown
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[.:]/g, '-');
  const stepDir = path.join(rootDir, 'artifacts', 'debug', sessionId, `${timestamp}-${stepName}`);
  await mkdir(stepDir, { recursive: true });
  await writeFile(path.join(stepDir, 'step.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  return stepDir;
}

export async function captureDebugStep(
  page: Page,
  rootDir: string,
  sessionId: string,
  stepName: string,
  meta: unknown
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[.:]/g, '-');
  const stepDir = path.join(rootDir, 'artifacts', 'debug', sessionId, `${timestamp}-${stepName}`);
  await mkdir(stepDir, { recursive: true });

  await page.screenshot({ path: path.join(stepDir, 'page.png'), fullPage: true });
  await writeFile(path.join(stepDir, 'step.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  return stepDir;
}
