import http from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionObservation } from '../../src/daemon/types.js';
import { findAddToCartTargets, findOpenCartTargets, isAddToCartConfirmed, isCartVisible } from '../../src/helpers/cart.js';
import { chooseSearchResultTarget, fillSearchAndSubmit } from '../../src/helpers/search.js';
import { matchSitePackByUrl } from '../../src/packs/loader.js';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const cliPath = path.join(repoRoot, 'dist/bin/browser-platform.js');
const tempDirs: string[] = [];
const defaultCamoufoxVenvPython = process.env.HOME ? path.join(process.env.HOME, '.openclaw', 'venvs', 'camoufox', 'bin', 'python') : '';
const camoufoxPythonCandidates = [
  process.env.CAMOUFOX_PYTHON_BIN,
  existsSync(defaultCamoufoxVenvPython) ? defaultCamoufoxVenvPython : undefined,
  'python',
  'python3'
].filter((value): value is string => Boolean(value));
const browserRuntimeAvailable = camoufoxPythonCandidates.some((pythonBin) => {
  const result = spawnSync(pythonBin, ['-m', 'camoufox', 'version'], { stdio: 'ignore' });
  return result.status === 0;
});
let server: http.Server;
let serverUrl = '';

beforeAll(async () => {
  await execFileAsync('npm', ['run', 'build'], { cwd: repoRoot });
});

beforeEach(async () => {
  server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const isAuthenticated = (request.headers.cookie ?? '').includes('auth=1');
    response.statusCode = 200;
    response.setHeader('content-type', 'text/html; charset=utf-8');

    if (url.pathname === '/auth/login') {
      response.end(`<!doctype html>
<html>
  <head><title>Login</title></head>
  <body>
    <main>
      <h1>Войти</h1>
      <form action="/auth/login" method="post">
        <label>Email</label>
        <input type="email" />
        <label>Пароль</label>
        <input type="password" />
        <button type="submit">Войти</button>
      </form>
    </main>
  </body>
</html>`);
      return;
    }

    if (url.pathname === '/account') {
      response.end(`<!doctype html>
<html>
  <head><title>Account</title></head>
  <body>
    <main>
      <h1>${isAuthenticated ? 'Профиль' : 'Гость'}</h1>
      <p>${isAuthenticated ? 'Мои книги' : 'Войти'}</p>
      <button>${isAuthenticated ? 'Выйти' : 'Войти'}</button>
    </main>
  </body>
</html>`);
      return;
    }

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
  const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd,
    env: {
      ...process.env,
      BROWSER_PLATFORM_STATE_ROOT: path.join(cwd, '.tmp/browser-platform')
    }
  });
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
        sessionCount: 0
      });
      expect(typeof (ensure.json?.daemon as { alreadyRunning?: unknown } | undefined)?.alreadyRunning).toBe('boolean');

      const open = await runCli(cwd, ['session', 'open', '--url', serverUrl, '--json']);
      expect(open.json?.ok).toBe(true);
      const openSession = open.json?.session as { sessionId: string; trace?: { tracePath: string } };
      const sessionId = String(openSession.sessionId);
      expect(open.json?.session).toMatchObject({
        url: serverUrl + '/',
        title: 'Observation Fixture',
        status: 'open',
        trace: {
          tracePath: expect.stringContaining(path.join('.tmp', 'browser-platform', 'artifacts', 'traces'))
        },
        packContext: {
          matchedPack: false,
          siteId: null
        },
        authContext: {
          state: 'anonymous',
          bootstrapAttempted: false,
          storageStateExists: false
        }
      });

      expect(JSON.parse(await readFile(String(openSession.trace?.tracePath), 'utf8'))).toMatchObject({
        sessionId,
        requestedUrl: serverUrl,
        timing: {
          durationMs: expect.any(Number),
          stages: expect.arrayContaining([expect.objectContaining({ step: 'open_session_initial', status: 'ok' })])
        },
        page: {
          title: 'Observation Fixture'
        }
      });

      const context = await runCli(cwd, ['session', 'context', '--session', sessionId, '--json']);
      expect(context.json).toMatchObject({
        ok: true,
        session: {
          sessionId,
          packContext: {
            matchedPack: false,
            instructionsSummary: []
          },
          authContext: {
            state: 'anonymous'
          }
        }
      });

      const observe = await runCli(cwd, ['session', 'observe', '--session', sessionId, '--json']);
      expect(observe.json).toMatchObject({
        ok: true,
        session: {
          sessionId,
          title: 'Observation Fixture',
          pageSignatureGuess: 'product_page',
          trace: {
            tracePath: expect.stringContaining(path.join('.tmp', 'browser-platform', 'artifacts', 'traces'))
          }
        }
      });
      expect((observe.json?.session as { visibleButtons: Array<{ text: string }> }).visibleButtons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: 'Submit search' }),
          expect.objectContaining({ text: 'Add to cart' })
        ])
      );
      expect(JSON.parse(await readFile(String((observe.json?.session as { trace?: { tracePath: string } }).trace?.tracePath), 'utf8'))).toMatchObject({
        sessionId,
        title: 'Observation Fixture',
        pageSignatureGuess: 'product_page'
      });

      const snapshot = await runCli(cwd, ['session', 'snapshot', '--session', sessionId, '--json']);
      expect(snapshot.json?.ok).toBe(true);
      const snapshotPayload = snapshot.json?.snapshot as { screenshotPath: string; htmlPath: string; trace?: { tracePath: string } };
      expect(snapshotPayload.screenshotPath).toContain(path.join('.tmp', 'browser-platform', 'artifacts', 'snapshots'));
      expect(snapshotPayload.htmlPath).toContain(path.join('.tmp', 'browser-platform', 'artifacts', 'snapshots'));
      expect(snapshotPayload.trace?.tracePath).toContain(path.join('.tmp', 'browser-platform', 'artifacts', 'traces'));
      expect(JSON.parse(await readFile(String(snapshotPayload.trace?.tracePath), 'utf8'))).toMatchObject({
        sessionId,
        screenshotPath: snapshotPayload.screenshotPath,
        htmlPath: snapshotPayload.htmlPath
      });

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

  it.skipIf(!browserRuntimeAvailable)('reuses provided storage state and reports auth state', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'browser-platform-test-'));
    tempDirs.push(cwd);

    const storageStatePath = path.join(cwd, 'storage-state.json');
    await writeFile(
      storageStatePath,
      `${JSON.stringify(
        {
          cookies: [
            {
              name: 'auth',
              value: '1',
              domain: '127.0.0.1',
              path: '/',
              expires: -1,
              httpOnly: false,
              secure: false,
              sameSite: 'Lax'
            }
          ],
          origins: []
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    await runCli(cwd, ['daemon', 'ensure', '--json']);
    const open = await runCli(cwd, [
      'session',
      'open',
      '--url',
      `${serverUrl}/account`,
      '--storage-state',
      storageStatePath,
      '--json'
    ]);

    expect(open.json).toMatchObject({
      ok: true,
      session: {
        title: 'Account',
        authContext: {
          state: 'authenticated',
          bootstrapAttempted: true,
          bootstrapSource: 'explicit',
          storageStateExists: true,
          storageStatePath,
          authenticatedSignals: expect.arrayContaining(['visible_my_books', 'visible_logout'])
        }
      }
    });
  }, 30_000);

  it.skipIf(!browserRuntimeAvailable)('detects login gate and reports it in auth state', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'browser-platform-test-'));
    tempDirs.push(cwd);

    await runCli(cwd, ['daemon', 'ensure', '--json']);
    const open = await runCli(cwd, ['session', 'open', '--url', `${serverUrl}/auth/login`, '--json']);

    expect(open.json).toMatchObject({
      ok: true,
      session: {
        title: 'Login',
        authContext: {
          state: 'login_gate_detected',
          loginGateDetected: true,
          bootstrapAttempted: false
        }
      }
    });
  }, 30_000);

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
        trace: {
          tracePath: expect.stringContaining(path.join('.tmp', 'browser-platform', 'artifacts', 'traces'))
        },
        observations: expect.arrayContaining([
          expect.objectContaining({ code: 'NO_OBVIOUS_CHANGE' })
        ])
      }
    });
    expect(JSON.parse(await readFile(String((fill.json?.action as { trace?: { tracePath: string } }).trace?.tracePath), 'utf8'))).toMatchObject({
      sessionId,
      action: 'fill',
      observations: expect.arrayContaining([
        expect.objectContaining({ code: 'NO_OBVIOUS_CHANGE' })
      ])
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

  it.skipIf(!browserRuntimeAvailable)('proves a LitRes-like search -> product -> add-to-cart -> cart flow with helpers', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'browser-platform-test-'));
    tempDirs.push(cwd);

    await runCli(cwd, ['daemon', 'ensure', '--json']);
    const open = await runCli(cwd, ['session', 'open', '--url', serverUrl, '--json']);
    const sessionId = String((open.json?.session as { sessionId: string }).sessionId);
    const pack = await matchSitePackByUrl('https://www.litres.ru/');
    const searchPlan = fillSearchAndSubmit(pack, 'Sample Book');

    const fill = await runCli(cwd, [
      'session',
      'act',
      '--session',
      sessionId,
      '--json',
      JSON.stringify({ ...searchPlan.fillTargets[0], selector: '#query' })
    ]);
    expect(fill.json?.ok).toBe(true);

    const submitTarget = searchPlan.submitTargets.find((target) => target.role === 'button') ?? searchPlan.submitTargets[0];
    const submit = await runCli(cwd, [
      'session',
      'act',
      '--session',
      sessionId,
      '--json',
      JSON.stringify({ ...submitTarget, text: 'Submit search', name: 'Submit search' })
    ]);
    expect(submit.json).toMatchObject({
      ok: true,
      action: {
        after: {
          title: 'Search Results',
          pageSignatureGuess: 'search_results'
        }
      }
    });

    const observed = await runCli(cwd, ['session', 'observe', '--session', sessionId, '--json']);
    const resultTarget = chooseSearchResultTarget(observed.json?.session as SessionObservation, 'Sample Book');
    expect(resultTarget).toEqual({ action: 'click', text: 'Sample Book Result' });

    const openProduct = await runCli(cwd, [
      'session',
      'act',
      '--session',
      sessionId,
      '--json',
      JSON.stringify(resultTarget)
    ]);
    expect(openProduct.json).toMatchObject({
      ok: true,
      action: {
        after: {
          title: 'Sample Book',
          pageSignatureGuess: 'product_page'
        }
      }
    });

    const addToCartTarget = findAddToCartTargets(pack).find((target) => target.role === 'button') ?? findAddToCartTargets(pack)[0];
    const addToCart = await runCli(cwd, [
      'session',
      'act',
      '--session',
      sessionId,
      '--json',
      JSON.stringify({ ...addToCartTarget, selector: '#add-to-cart', name: 'Add to cart', text: 'Add to cart' })
    ]);
    expect(addToCart.json?.ok).toBe(true);
    const addAction = addToCart.json?.action as {
      before: SessionObservation;
      after: SessionObservation;
      changes: { urlChanged: boolean; titleChanged: boolean; pageSignatureChanged: boolean; addedButtons: string[]; removedButtons: string[]; addedTexts: string[]; removedTexts: string[] };
      observations: Array<{ level: 'info' | 'warning'; code: string; message: string }>;
    };
    expect(isAddToCartConfirmed(addAction)).toBe(true);

    const openCartTarget = findOpenCartTargets(pack).find((target) => target.role === 'link') ?? findOpenCartTargets(pack)[0];
    const openCart = await runCli(cwd, [
      'session',
      'act',
      '--session',
      sessionId,
      '--json',
      JSON.stringify({ ...openCartTarget, selector: '#go-cart', name: 'Go to cart', text: 'Go to cart' })
    ]);
    expect(openCart.json?.ok).toBe(true);
    expect(isCartVisible((openCart.json?.action as { after: SessionObservation }).after)).toBe(true);
    expect(openCart.json).toMatchObject({
      ok: true,
      action: {
        after: {
          title: 'Your Cart',
          pageSignatureGuess: 'cart'
        }
      }
    });
  }, 30_000);

  it.skipIf(!browserRuntimeAvailable)('proves a LitRes-like search -> results -> product flow with search helpers', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'browser-platform-test-'));
    tempDirs.push(cwd);

    await runCli(cwd, ['daemon', 'ensure', '--json']);
    const open = await runCli(cwd, ['session', 'open', '--url', serverUrl, '--json']);
    const sessionId = String((open.json?.session as { sessionId: string }).sessionId);
    const pack = await matchSitePackByUrl('https://www.litres.ru/');
    const searchPlan = fillSearchAndSubmit(pack, 'Sample Book');

    const fill = await runCli(cwd, [
      'session',
      'act',
      '--session',
      sessionId,
      '--json',
      JSON.stringify({ ...searchPlan.fillTargets[0], selector: '#query' })
    ]);
    expect(fill.json?.ok).toBe(true);

    const submitTarget = searchPlan.submitTargets.find((target) => target.role === 'button') ?? searchPlan.submitTargets[0];
    const submit = await runCli(cwd, [
      'session',
      'act',
      '--session',
      sessionId,
      '--json',
      JSON.stringify({ ...submitTarget, text: 'Submit search', name: 'Submit search' })
    ]);
    expect(submit.json).toMatchObject({
      ok: true,
      action: {
        after: {
          title: 'Search Results',
          pageSignatureGuess: 'search_results'
        }
      }
    });

    const observed = await runCli(cwd, ['session', 'observe', '--session', sessionId, '--json']);
    const resultTarget = chooseSearchResultTarget(observed.json?.session as SessionObservation, 'Sample Book');
    expect(resultTarget).toEqual({ action: 'click', text: 'Sample Book Result' });

    const openProduct = await runCli(cwd, [
      'session',
      'act',
      '--session',
      sessionId,
      '--json',
      JSON.stringify(resultTarget)
    ]);
    expect(openProduct.json).toMatchObject({
      ok: true,
      action: {
        after: {
          title: 'Sample Book',
          pageSignatureGuess: 'product_page'
        }
      }
    });
  }, 30_000);
});
