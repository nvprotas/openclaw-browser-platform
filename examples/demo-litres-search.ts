import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { SessionObservation } from '../src/daemon/types.js';
import { chooseSearchResultTarget, fillSearchAndSubmit } from '../src/helpers/search.js';
import { matchSitePackByUrl } from '../src/packs/loader.js';

const execFileAsync = promisify(execFile);

async function runCli(args: string[], cwd: string) {
  const cliPath = path.resolve(cwd, 'dist/bin/browser-platform.js');
  const { stdout } = await execFileAsync(process.execPath, [cliPath, ...args], { cwd });
  return JSON.parse(stdout) as Record<string, unknown>;
}

async function main() {
  const cwd = path.resolve(import.meta.dirname, '..');
  const query = process.argv[2] ?? '1984';
  const startUrl = 'https://www.litres.ru/';
  const pack = await matchSitePackByUrl(startUrl);
  const plan = fillSearchAndSubmit(pack, query);

  await runCli(['daemon', 'ensure', '--json'], cwd);
  const open = await runCli(['session', 'open', '--url', startUrl, '--json'], cwd);
  const sessionId = String((open.session as { sessionId: string }).sessionId);

  let fillOk = false;
  for (const target of plan.fillTargets) {
    const response = await runCli(['session', 'act', '--session', sessionId, '--json', JSON.stringify(target)], cwd);
    if (response.ok) {
      fillOk = true;
      break;
    }
  }

  if (!fillOk) {
    throw new Error('Unable to fill LitRes search input with current helper candidates');
  }

  let submitOk = false;
  for (const target of plan.submitTargets) {
    const response = await runCli(['session', 'act', '--session', sessionId, '--json', JSON.stringify(target)], cwd);
    if (response.ok) {
      submitOk = true;
      break;
    }
  }

  if (!submitOk) {
    throw new Error('Unable to submit LitRes search with current helper candidates');
  }

  const observed = await runCli(['session', 'observe', '--session', sessionId, '--json'], cwd);
  const resultTarget = chooseSearchResultTarget(observed.session as SessionObservation, query);
  if (!resultTarget) {
    throw new Error('Search results became visible, but no result target matched the query');
  }

  const openProduct = await runCli(['session', 'act', '--session', sessionId, '--json', JSON.stringify(resultTarget)], cwd);
  process.stdout.write(`${JSON.stringify(openProduct, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
