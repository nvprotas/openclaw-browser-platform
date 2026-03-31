import http from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const cliPath = path.join(repoRoot, 'dist/bin/browser-platform.js');
const tempDirs: string[] = [];
const browserRuntimeAvailable = existsSync(chromium.executablePath());
let server: http.Server;
let serverUrl = '';

beforeAll(async () => {
  await execFileAsync('npm', ['run', 'build'], { cwd: repoRoot });
});

beforeEach(async () => {
  server = http.createServer((request, response) => {
    response.statusCode = 200;
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(`<!doctype html>
<html>
  <head>
    <title>Observation Fixture</title>
  </head>
  <body>
    <main>
      <h1>Browser Platform Fixture</h1>
      <p>This page exists for observe and snapshot integration coverage.</p>
      <form id="search-form" method="get" action="/search">
        <label for="query">Search</label>
        <input id="query" name="query" type="text" />
        <button type="submit">Submit search</button>
      </form>
      <button aria-label="Add sample to cart">Add to cart</button>
    </main>
  </body>
</html>`);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  serverUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }

    try {
      const raw = await readFile(path.join(dir, '.tmp/browser-platform/daemon.json'), 'utf8');
      const info = JSON.parse(raw) as { pid: number };
      process.kill(info.pid, 'SIGTERM');
    } catch {
      // ignore cleanup failures
    }

    await rm(dir, { recursive: true, force: true });
  }
});

afterAll(async () => {
  if (server.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function runCli(cwd: string, args: string[]) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, ...args], { cwd });
  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    json: stdout.trim() ? (JSON.parse(stdout) as Record<string, unknown>) : null
  };
}

describe('browser-platform CLI + daemon runtime', () => {
  it.skipIf(!browserRuntimeAvailable)(
    'keeps session state across invocations and exposes observe/snapshot JSON',
    async () => {
      const cwd = await mkdtemp(path.join(os.tmpdir(), 'browser-platform-test-'));
      tempDirs.push(cwd);

      const ensure = await runCli(cwd, ['daemon', 'ensure', '--json']);
      expect(ensure.json?.ok).toBe(true);
      expect(ensure.json?.daemon).toMatchObject({
        alreadyRunning: false,
        sessionCount: 0
      });

      const open = await runCli(cwd, ['session', 'open', '--url', serverUrl, '--json']);
      expect(open.json?.ok).toBe(true);
      const sessionId = String((open.json?.session as { sessionId: string }).sessionId);
      expect(open.json?.session).toMatchObject({
        url: serverUrl + '/',
        title: 'Observation Fixture',
        status: 'open'
      });

      const observe = await runCli(cwd, ['session', 'observe', '--session', sessionId, '--json']);
      expect(observe.json).toMatchObject({
        ok: true,
        session: {
          sessionId,
          title: 'Observation Fixture',
          pageSignatureGuess: 'product_page'
        }
      });
      expect((observe.json?.session as { visibleButtons: Array<{ text: string }> }).visibleButtons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: 'Submit search' }),
          expect.objectContaining({ text: 'Add to cart' })
        ])
      );

      const snapshot = await runCli(cwd, ['session', 'snapshot', '--session', sessionId, '--json']);
      expect(snapshot.json?.ok).toBe(true);
      const snapshotPayload = snapshot.json?.snapshot as { screenshotPath: string; htmlPath: string };
      expect(snapshotPayload.screenshotPath).toContain(path.join('.tmp', 'browser-platform', 'artifacts', 'snapshots'));
      expect(snapshotPayload.htmlPath).toContain(path.join('.tmp', 'browser-platform', 'artifacts', 'snapshots'));

      const close = await runCli(cwd, ['session', 'close', '--session', sessionId, '--json']);
      expect(close.json).toMatchObject({
        ok: true,
        session: {
          sessionId,
          status: 'closed'
        }
      });
    },
    30_000
  );
});
