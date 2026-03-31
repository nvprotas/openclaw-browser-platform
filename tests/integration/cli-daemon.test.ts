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
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    response.statusCode = 200;
    response.setHeader('content-type', 'text/html; charset=utf-8');

    if (url.pathname === '/search') {
      const query = url.searchParams.get('query') ?? '';
      response.end(`<!doctype html>
<html>
  <head><title>Search Results</title></head>
  <body>
    <main>
      <h1>Results for ${query}</h1>
      <a href="/book/1">Sample Book Result</a>
      <button>Open filters</button>
    </main>
  </body>
</html>`);
      return;
    }

    if (url.pathname === '/book/1') {
      response.end(`<!doctype html>
<html>
  <head><title>Sample Book</title></head>
  <body>
    <main>
      <h1>Sample Book</h1>
      <p>Book details page</p>
      <button id="add-to-cart" onclick="document.querySelector('#cart-status').textContent='Added to cart'; document.querySelector('#go-cart').hidden = false; this.textContent='Added';">Add to cart</button>
      <p id="cart-status">Not added</p>
      <a id="go-cart" href="/cart" hidden>Go to cart</a>
    </main>
  </body>
</html>`);
      return;
    }

    if (url.pathname === '/cart') {
      response.end(`<!doctype html>
<html>
  <head><title>Your Cart</title></head>
  <body>
    <main>
      <h1>Your cart</h1>
      <p>Sample Book</p>
      <button>Proceed to checkout</button>
    </main>
  </body>
</html>`);
      return;
    }

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

  it.skipIf(!browserRuntimeAvailable)('runs a realistic action flow through session act', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'browser-platform-test-'));
    tempDirs.push(cwd);

    await runCli(cwd, ['daemon', 'ensure', '--json']);
    const open = await runCli(cwd, ['session', 'open', '--url', serverUrl, '--json']);
    const sessionId = String((open.json?.session as { sessionId: string }).sessionId);

    const fill = await runCli(cwd, [
      'session',
      'act',
      '--session',
      sessionId,
      '--json',
      JSON.stringify({ action: 'fill', selector: '#query', value: 'Sample Book' })
    ]);
    expect(fill.json).toMatchObject({
      ok: true,
      action: {
        action: 'fill',
        after: {
          title: 'Observation Fixture',
          pageSignatureGuess: 'product_page'
        },
        observations: expect.arrayContaining([
          expect.objectContaining({ code: 'NO_OBVIOUS_CHANGE' })
        ])
      }
    });

    const submit = await runCli(cwd, [
      'session',
      'act',
      '--session',
      sessionId,
      '--json',
      JSON.stringify({ action: 'press', selector: '#query', key: 'Enter' })
    ]);
    expect(submit.json).toMatchObject({
      ok: true,
      action: {
        action: 'press',
        after: {
          title: 'Search Results',
          pageSignatureGuess: 'search_results'
        },
        changes: {
          urlChanged: true
        }
      }
    });

    const waitForResult = await runCli(cwd, [
      'session',
      'act',
      '--session',
      sessionId,
      '--json',
      JSON.stringify({ action: 'wait_for', text: 'Sample Book Result' })
    ]);
    expect(waitForResult.json?.ok).toBe(true);

    const openProduct = await runCli(cwd, [
      'session',
      'act',
      '--session',
      sessionId,
      '--json',
      JSON.stringify({ action: 'click', text: 'Sample Book Result' })
    ]);
    expect(openProduct.json).toMatchObject({
      ok: true,
      action: {
        action: 'click',
        after: {
          title: 'Sample Book',
          pageSignatureGuess: 'product_page'
        }
      }
    });

    const addToCart = await runCli(cwd, [
      'session',
      'act',
      '--session',
      sessionId,
      '--json',
      JSON.stringify({ action: 'click', selector: '#add-to-cart' })
    ]);
    expect(addToCart.json).toMatchObject({
      ok: true,
      action: {
        action: 'click',
        after: {
          title: 'Sample Book',
          pageSignatureGuess: 'cart'
        },
        changes: {
          addedTexts: expect.arrayContaining(['Added to cart'])
        },
        observations: expect.arrayContaining([
          expect.objectContaining({ code: 'CART_VISIBLE' })
        ])
      }
    });

    const openCart = await runCli(cwd, [
      'session',
      'act',
      '--session',
      sessionId,
      '--json',
      JSON.stringify({ action: 'click', selector: '#go-cart' })
    ]);
    expect(openCart.json).toMatchObject({
      ok: true,
      action: {
        action: 'click',
        after: {
          title: 'Your Cart',
          pageSignatureGuess: 'cart'
        },
        changes: {
          urlChanged: true
        },
        observations: expect.arrayContaining([
          expect.objectContaining({ code: 'CART_VISIBLE' })
        ])
      }
    });
  }, 30_000);
});
