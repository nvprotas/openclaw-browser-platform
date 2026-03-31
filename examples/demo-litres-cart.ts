import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { SessionObservation } from '../src/daemon/types.js';
import { findAddToCartTargets, findOpenCartTargets, isAddToCartConfirmed, isCartVisible } from '../src/helpers/cart.js';
import { chooseSearchResultTarget, fillSearchAndSubmit } from '../src/helpers/search.js';
import { matchSitePackByUrl } from '../src/packs/loader.js';

const execFileAsync = promisify(execFile);

async function runCli(args: string[], cwd: string) {
  const cliPath = path.resolve(cwd, 'dist/bin/browser-platform.js');
  const { stdout } = await execFileAsync(process.execPath, [cliPath, ...args], { cwd });
  return JSON.parse(stdout) as Record<string, unknown>;
}

async function runFirstSuccessfulAction<T extends object>(cwd: string, sessionId: string, targets: T[], overrides: Record<string, unknown> = {}) {
  for (const target of targets) {
    const response = await runCli(['session', 'act', '--session', sessionId, '--json', JSON.stringify({ ...target, ...overrides })], cwd);
    if (response.ok) {
      return response;
    }
  }

  return null;
}

async function main() {
  const cwd = path.resolve(import.meta.dirname, '..');
  const query = process.argv[2] ?? '1984';
  const startUrl = 'https://www.litres.ru/';
  const pack = await matchSitePackByUrl(startUrl);
  const searchPlan = fillSearchAndSubmit(pack, query);

  await runCli(['daemon', 'ensure', '--json'], cwd);
  const open = await runCli(['session', 'open', '--url', startUrl, '--json'], cwd);
  const sessionId = String((open.session as { sessionId: string }).sessionId);

  const fill = await runFirstSuccessfulAction(cwd, sessionId, searchPlan.fillTargets);
  if (!fill) {
    throw new Error('Unable to fill LitRes search input with current helper candidates');
  }

  const submit = await runFirstSuccessfulAction(cwd, sessionId, searchPlan.submitTargets);
  if (!submit) {
    throw new Error('Unable to submit LitRes search with current helper candidates');
  }

  const observed = await runCli(['session', 'observe', '--session', sessionId, '--json'], cwd);
  const resultTarget = chooseSearchResultTarget(observed.session as SessionObservation, query);
  if (!resultTarget) {
    throw new Error('Search results became visible, but no result target matched the query');
  }

  await runCli(['session', 'act', '--session', sessionId, '--json', JSON.stringify(resultTarget)], cwd);

  const addToCart = await runFirstSuccessfulAction(cwd, sessionId, findAddToCartTargets(pack));
  if (!addToCart) {
    throw new Error('Unable to click add-to-cart with current helper candidates');
  }

  const addAction = addToCart.action as {
    before: SessionObservation;
    after: SessionObservation;
    changes: { urlChanged: boolean; titleChanged: boolean; pageSignatureChanged: boolean; addedButtons: string[]; removedButtons: string[]; addedTexts: string[]; removedTexts: string[] };
    observations: Array<{ level: 'info' | 'warning'; code: string; message: string }>;
  };
  if (!isAddToCartConfirmed(addAction)) {
    throw new Error('Add-to-cart action completed, but helper validation did not confirm success');
  }

  const openCart = await runFirstSuccessfulAction(cwd, sessionId, findOpenCartTargets(pack));
  if (!openCart) {
    throw new Error('Unable to open LitRes cart with current helper candidates');
  }

  const after = (openCart.action as { after: SessionObservation }).after;
  if (!isCartVisible(after)) {
    throw new Error('Cart action completed, but resulting page did not validate as cart');
  }

  process.stdout.write(`${JSON.stringify(openCart, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
