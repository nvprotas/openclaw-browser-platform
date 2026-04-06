import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { firefox, type Browser, type BrowserContext, type LaunchOptions, type Page } from 'playwright';
import { BrowserPlatformError } from '../core/errors.js';
import type { SessionBackend, SessionPaymentContext } from '../daemon/types.js';
import { extractPaymentContext } from '../helpers/payment-context.js';
import type { ObserveSummary } from './dom-utils.js';
import { capturePageSnapshot, type SnapshotPaths } from './snapshots.js';
import { waitForInitialLoad } from './waits.js';

export interface BrowserSessionOptions {
  sessionId: string;
  snapshotRootDir: string;
  launchOptions?: LaunchOptions;
  storageStatePath?: string;
  backend?: SessionBackend;
  camoufoxStartupTimeoutMs?: number;
  contextPool?: BrowserContextPool;
}

export interface PageStateSummary extends ObserveSummary {
  url: string;
  title: string;
  readyState: string;
  viewport: {
    width: number;
    height: number;
  };
  paymentContext: SessionPaymentContext;
}

export interface BrowserSessionOpenResult {
  url: string;
  title: string;
  timing?: {
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    stages: Array<{
      step: string;
      startedAt: string;
      finishedAt: string;
      durationMs: number;
      status: 'ok' | 'error';
      detail: string | null;
    }>;
  };
}

export interface AdoptedBrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  stop: () => void;
}

type BrowserSessionOpenTimingStage = {
  step: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: 'ok' | 'error';
  detail: string | null;
};

type SharedBrowserContextEntry = {
  key: string;
  browser: Browser;
  context: BrowserContext;
  stop: () => void;
  refCount: number;
};

type BrowserContextLease = {
  browser: Browser;
  context: BrowserContext;
  reused: boolean;
  release: () => void;
};

export interface BrowserSessionSnapshotResult extends SnapshotPaths {
  state: PageStateSummary;
}

const CAMOUFOX_WS_REGEX = /wss?:\/\/[^\s"'<>]+/i;
const CAMOUFOX_SERVER_WRAPPER = `
import atexit
import base64
import signal
import subprocess
import sys
from pathlib import Path

import camoufox.server as server

config = server.launch_options(headless=True)
if config.get("proxy") is None:
    config.pop("proxy", None)

data = server.orjson.dumps(server.to_camel_case_dict(config))
nodejs = server.get_nodejs()

process = subprocess.Popen(
    [nodejs, str(server.LAUNCH_SCRIPT)],
    cwd=Path(nodejs).parent / "package",
    stdin=subprocess.PIPE,
    text=True,
)

def terminate_child() -> None:
    if process.poll() is not None:
        return

    process.terminate()
    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()

def handle_signal(_signum, _frame) -> None:
    terminate_child()
    sys.exit(0)

atexit.register(terminate_child)
signal.signal(signal.SIGTERM, handle_signal)
signal.signal(signal.SIGINT, handle_signal)

if process.stdin:
    process.stdin.write(base64.b64encode(data).decode())
    process.stdin.close()

process.wait()
raise RuntimeError("Server process terminated unexpectedly")
`.trim();

export function extractWebsocketEndpoint(logLine: string): string | null {
  const normalized = logLine.trim();
  if (!normalized) {
    return null;
  }

  const matched = normalized.match(CAMOUFOX_WS_REGEX);
  if (!matched) {
    return null;
  }

  const candidate = matched[0].replace(/[\])},;]+$/, '');
  return candidate.startsWith('ws://') || candidate.startsWith('wss://') ? candidate : null;
}

export function resolveCamoufoxPythonCommand(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.CAMOUFOX_PYTHON_BIN?.trim();
  if (explicit) {
    return explicit;
  }

  const openclawHome = env.OPENCLAW_HOME?.trim() || (env.HOME ? `${env.HOME}/.openclaw` : '');
  const defaultVenvPython = openclawHome ? `${openclawHome}/venvs/camoufox/bin/python` : '';
  if (defaultVenvPython && existsSync(defaultVenvPython)) {
    return defaultVenvPython;
  }

  const explicitVenvDir = env.CAMOUFOX_VENV_DIR?.trim();
  const explicitVenvPython = explicitVenvDir ? `${explicitVenvDir}/bin/python` : '';
  if (explicitVenvPython && existsSync(explicitVenvPython)) {
    return explicitVenvPython;
  }

  const pathValue = env.PATH ?? '';
  const pathEntries = pathValue.split(':').filter((entry) => entry.length > 0);
  const hasPython = pathEntries.some((entry) => existsSync(`${entry}/python`));
  if (hasPython) {
    return 'python';
  }

  const hasPython3 = pathEntries.some((entry) => existsSync(`${entry}/python3`));
  if (hasPython3) {
    return 'python3';
  }

  return 'python';
}

export function buildCamoufoxServerArgs(): string[] {
  return ['-c', CAMOUFOX_SERVER_WRAPPER];
}

function isProcessRunning(proc: ChildProcess): boolean {
  return proc.exitCode === null && proc.signalCode === null;
}

function isoNow(): string {
  return new Date().toISOString();
}

function createOpenTimingCollector() {
  const stages: BrowserSessionOpenTimingStage[] = [];

  return {
    stages,
    async run<T>(step: string, fn: () => Promise<T>, detail: string | null = null): Promise<T> {
      const startedAt = isoNow();
      const startedMs = Date.now();

      try {
        const result = await fn();
        stages.push({
          step,
          startedAt,
          finishedAt: isoNow(),
          durationMs: Date.now() - startedMs,
          status: 'ok',
          detail
        });
        return result;
      } catch (error) {
        stages.push({
          step,
          startedAt,
          finishedAt: isoNow(),
          durationMs: Date.now() - startedMs,
          status: 'error',
          detail: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
  };
}

function stopCamoufoxProcess(proc: ChildProcess): void {
  if (!isProcessRunning(proc)) {
    return;
  }

  proc.kill('SIGTERM');
  const killTimer = setTimeout(() => {
    if (isProcessRunning(proc)) {
      proc.kill('SIGKILL');
    }
  }, 3_000);
  killTimer.unref();
}

async function waitForCamoufoxEndpointFromProcess(
  proc: ChildProcess,
  timeoutMs: number,
  onFailure?: () => void
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const recentLogs: string[] = [];
    let settled = false;
    let lineBuffer = '';

    const cleanup = () => {
      settled = true;
      clearTimeout(timeout);
      proc.stdout?.off('data', onData);
      proc.stderr?.off('data', onData);
      proc.off('exit', onExit);
      proc.off('error', onError);
      proc.stdout?.resume();
      proc.stderr?.resume();
    };

    const finishWithError = (message: string): void => {
      if (settled) {
        return;
      }
      cleanup();
      onFailure?.();
      reject(new BrowserPlatformError(message, {
        code: 'SESSION_OPEN_FAILED',
        details: {
          recentLogs: recentLogs.slice(-10)
        }
      }));
    };

    const onData = (chunk: Buffer) => {
      lineBuffer += chunk.toString('utf8');
      const parts = lineBuffer.split(/\r?\n/);
      lineBuffer = parts.pop() ?? '';
      for (const rawLine of parts) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }
        recentLogs.push(line);
        const wsEndpoint = extractWebsocketEndpoint(line);
        if (!wsEndpoint || settled) {
          continue;
        }
        cleanup();
        resolve(wsEndpoint);
        return;
      }
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finishWithError(`Camoufox server exited before publishing ws endpoint (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
    };

    const onError = (error: Error) => {
      finishWithError(`Failed to start Camoufox server: ${error.message}`);
    };

    const timeout = setTimeout(() => {
      finishWithError(`Timed out waiting for Camoufox ws endpoint after ${timeoutMs}ms`);
    }, timeoutMs);

    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.once('exit', onExit);
    proc.once('error', onError);
  });
}

export async function launchCamoufoxBrowser(timeoutMs = 60_000): Promise<{ browser: Browser; stop: () => void }> {
  const pythonBin = resolveCamoufoxPythonCommand();
  const proc = spawn(pythonBin, buildCamoufoxServerArgs(), { stdio: ['ignore', 'pipe', 'pipe'] });
  const wsEndpoint = await waitForCamoufoxEndpointFromProcess(proc, timeoutMs, () => stopCamoufoxProcess(proc));

  try {
    const browser = await firefox.connect(wsEndpoint, { timeout: timeoutMs });
    return {
      browser,
      stop: () => stopCamoufoxProcess(proc)
    };
  } catch (error) {
    stopCamoufoxProcess(proc);
    throw new BrowserPlatformError('Camoufox started but Playwright Firefox failed to connect', {
      code: 'SESSION_OPEN_FAILED',
      details: {
        wsEndpoint,
        cause: error instanceof Error ? error.message : String(error)
      }
    });
  }
}

export class BrowserContextPool {
  private readonly entries = new Map<string, SharedBrowserContextEntry>();

  async acquire(options: {
    backend?: SessionBackend;
    storageStatePath: string;
    viewport?: { width: number; height: number };
    camoufoxStartupTimeoutMs?: number;
  }): Promise<BrowserContextLease> {
    const backend = options.backend ?? 'camoufox';
    const key = `${backend}:${options.storageStatePath}`;
    const existing = this.entries.get(key);
    if (existing) {
      existing.refCount += 1;
      return {
        browser: existing.browser,
        context: existing.context,
        reused: true,
        release: () => this.release(key)
      };
    }

    const launched = await launchCamoufoxBrowser(options.camoufoxStartupTimeoutMs);

    try {
      const context = await launched.browser.newContext({
        viewport: options.viewport ?? { width: 1440, height: 900 },
        storageState: options.storageStatePath
      });
      const created: SharedBrowserContextEntry = {
        key,
        browser: launched.browser,
        context,
        stop: launched.stop,
        refCount: 1
      };
      this.entries.set(key, created);

      return {
        browser: created.browser,
        context: created.context,
        reused: false,
        release: () => this.release(key)
      };
    } catch (error) {
      await launched.browser.close().catch(() => undefined);
      launched.stop();
      throw error;
    }
  }

  async closeAll(): Promise<void> {
    const entries = [...this.entries.values()];
    this.entries.clear();
    await Promise.all(
      entries.map(async (entry) => {
        await entry.context.close().catch(() => undefined);
        await entry.browser.close().catch(() => undefined);
        entry.stop();
      })
    );
  }

  private release(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }

    entry.refCount = Math.max(0, entry.refCount - 1);
  }
}

export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pageInstance: Page | null = null;
  private stopCamoufoxBrowser: (() => void) | null = null;
  private contextLease: BrowserContextLease | null = null;

  constructor(private readonly options: BrowserSessionOptions) {}

  adoptExisting(session: AdoptedBrowserSession): void {
    this.browser = session.browser;
    this.context = session.context;
    this.pageInstance = session.page;
    this.stopCamoufoxBrowser = session.stop;
    this.contextLease = null;
  }

  async open(url: string): Promise<BrowserSessionOpenResult> {
    const backend = this.options.backend ?? 'camoufox';
    const openStartedAt = isoNow();
    const openStartedMs = Date.now();
    const timing = createOpenTimingCollector();

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      if (this.options.contextPool && this.options.storageStatePath) {
        const lease = await timing.run(
          'acquire_shared_context',
          () =>
            this.options.contextPool!.acquire({
              backend,
              storageStatePath: this.options.storageStatePath!,
              viewport: { width: 1440, height: 900 },
              camoufoxStartupTimeoutMs: this.options.camoufoxStartupTimeoutMs
            }),
          this.options.storageStatePath
        );
        this.contextLease = lease;
        browser = lease.browser;
        context = lease.context;
        timing.stages.push({
          step: lease.reused ? 'reuse_shared_context' : 'create_shared_context',
          startedAt: isoNow(),
          finishedAt: isoNow(),
          durationMs: 0,
          status: 'ok',
          detail: this.options.storageStatePath
        });
      } else {
        const launched = await timing.run('launch_camoufox_browser', () =>
          launchCamoufoxBrowser(this.options.camoufoxStartupTimeoutMs)
        );
        this.stopCamoufoxBrowser = launched.stop;
        browser = launched.browser;
        const readyBrowser = browser;

        context = await timing.run(
          'new_context',
          () =>
            readyBrowser.newContext({
              viewport: { width: 1440, height: 900 },
              storageState: this.options.storageStatePath
            }),
          this.options.storageStatePath ?? null
        );
      }
      const readyContext = context;

      page = await timing.run('new_page', () => readyContext.newPage());
      const readyPage = page;
      await timing.run('goto_domcontentloaded', () => readyPage.goto(url, { waitUntil: 'domcontentloaded' }), url);
      await timing.run('wait_for_initial_load', () => waitForInitialLoad(readyPage));
    } catch (error) {
      await page?.close().catch(() => undefined);
      if (this.contextLease) {
        this.contextLease.release();
        this.contextLease = null;
      } else {
        await context?.close().catch(() => undefined);
        await browser?.close().catch(() => undefined);
        this.stopCamoufoxBrowser?.();
        this.stopCamoufoxBrowser = null;
      }

      throw new BrowserPlatformError(`Failed to open browser session (${backend})`, {
        code: 'SESSION_OPEN_FAILED',
        details: {
          backend,
          url,
          cause: error instanceof Error ? error.message : String(error)
        }
      });
    }

    if (!browser || !context || !page) {
      throw new BrowserPlatformError(`Failed to open browser session (${backend})`, {
        code: 'SESSION_OPEN_FAILED',
        details: {
          backend,
          url,
          cause: 'Browser session was not initialized'
        }
      });
    }

    this.browser = browser;
    this.context = context;
    this.pageInstance = page;
    await timing.run('persist_storage_state', () => this.persistStorageState(), this.options.storageStatePath ?? null);
    const readyPage = page;

    return {
      url: readyPage.url(),
      title: await timing.run('read_page_title', () => readyPage.title()),
      timing: {
        startedAt: openStartedAt,
        finishedAt: isoNow(),
        durationMs: Date.now() - openStartedMs,
        stages: timing.stages
      }
    };
  }

  page(): Page {
    return this.requirePage();
  }

  async waitForInitialLoad(): Promise<void> {
    await waitForInitialLoad(this.requirePage());
  }

  async persistStorageState(): Promise<void> {
    if (!this.context || !this.options.storageStatePath) {
      return;
    }

    await this.context.storageState({ path: this.options.storageStatePath });
  }

  async observe(): Promise<PageStateSummary> {
    const page = this.requirePage();
    const summary = (await page.evaluate(() => {
      const normalizeText = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim();

      // Use TreeWalker to collect visible text nodes — works on CSS-modules/React sites
      // where class names are hashed and semantic selectors don't match.
      // Start from body (not just main) so header signals like "Профиль"/"Войти" are included
      // for auth detection. Content from <main> follows naturally in DOM order.
      const mainEl = document.body;
      const seenTexts = new Set<string>();
      const visibleTexts: string[] = [];
      const walker = document.createTreeWalker(mainEl, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      while (textNode && visibleTexts.length < 30) {
        const raw = normalizeText(textNode.textContent);
        if (raw.length >= 3) {
          const parent = textNode.parentElement;
          if (parent) {
            const style = window.getComputedStyle(parent);
            const rect = parent.getBoundingClientRect();
            if (style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0) {
              if (!seenTexts.has(raw)) {
                seenTexts.add(raw);
                visibleTexts.push(raw);
              }
            }
          }
        }
        textNode = walker.nextNode();
      }

      const isVisible = (element: HTMLElement) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      };
      const toButtonSummary = (element: HTMLElement) => {
        const inputType = element instanceof HTMLInputElement ? element.type : null;
        const text = normalizeText(
          element instanceof HTMLInputElement ? element.value : element.innerText || element.textContent
        );
        const ariaLabel = normalizeText(element.getAttribute('aria-label')) || null;
        const selector = (() => {
          const testId = element.getAttribute('data-testid');
          if (testId) return `[data-testid="${testId}"]`;
          const id = element.id;
          if (id) return `#${id}`;
          const tag = element.tagName.toLowerCase();
          const label = element.getAttribute('aria-label');
          if (label) return `${tag}[aria-label="${label}"]`;
          const name = element.getAttribute('name');
          if (name) return `${tag}[name="${name}"]`;
          return null;
        })();
        return {
          text,
          role: element.getAttribute('role') ?? element.tagName.toLowerCase(),
          type: inputType,
          ariaLabel,
          selector
        };
      };

      // Priority: buy/cart buttons first, then the rest
      const prioritySelectors = [
        "button:not([disabled])[class*='buy']",
        "button:not([disabled])[class*='cart']",
        "button:not([disabled])[class*='purchase']",
        "[role='button'][class*='buy']",
        "[role='button'][class*='cart']",
        "[data-testid*='buy']",
        "[data-testid*='cart']",
        "[data-testid*='purchase']"
      ];
      const priorityButtons = prioritySelectors
        .flatMap((sel) => Array.from(document.querySelectorAll<HTMLElement>(sel)))
        .filter(isVisible)
        .map(toButtonSummary)
        .filter((button) => button.text.length > 0 || button.ariaLabel);

      const allButtons = Array.from(
        document.querySelectorAll<HTMLElement>('button, input[type="button"], input[type="submit"], [role="button"]')
      )
        .filter(isVisible)
        .map(toButtonSummary)
        .filter((button) => button.text.length > 0 || button.ariaLabel);

      const seen = new Set<string>();
      const visibleButtons = [...priorityButtons, ...allButtons]
        .filter((button) => {
          const key = `${button.text}|${button.ariaLabel ?? ''}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 20);

      const forms = Array.from(document.forms).map((form) => {
        const submitLabels = Array.from(
          form.querySelectorAll<HTMLInputElement | HTMLButtonElement>('button, input[type="submit"]')
        )
          .map((element) =>
            normalizeText(element instanceof HTMLInputElement ? element.value : element.innerText || element.textContent)
          )
          .filter((text) => text.length > 0)
          .slice(0, 4);

        return {
          id: form.id || null,
          name: form.getAttribute('name'),
          method: form.getAttribute('method'),
          action: form.getAttribute('action'),
          inputCount: form.querySelectorAll('input, textarea, select').length,
          submitLabels
        };
      });

      const urlHintSources = [
        ...Array.from(document.querySelectorAll<HTMLElement>(
          'a[href], iframe[src], frame[src], form[action], [data-href], [data-url], [data-link], [data-target-url]'
        )).map((element) =>
          element.getAttribute('href') ??
          element.getAttribute('src') ??
          element.getAttribute('action') ??
          element.getAttribute('data-href') ??
          element.getAttribute('data-url') ??
          element.getAttribute('data-link') ??
          element.getAttribute('data-target-url')
        ),
        ...Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="application/json"], script[type="application/ld+json"], script'))
          .map((script) => normalizeText(script.textContent))
          .filter((value) => value.length > 0)
      ];

      const urlHints = urlHintSources
        .flatMap((raw) => {
          if (!raw) {
            return [];
          }

          const normalized = normalizeText(raw);
          const matches = normalized.match(
            /https?:\/\/(?:www\.)?(?:payecom\.ru\/pay(?:_ru)?|platiecom\.ru\/deeplink|id\.sber\.ru\/[^\s"'<>)]*)[^\s"'<>)]*|(?:orderid|bankinvoiceid|mdorder|merchantorderid|merchantordernumber|formurl|purchase\/ppd)[^\s"'<>]*/gi
          );

          if (matches?.length) {
            return matches.slice(0, 6);
          }

          try {
            return [new URL(normalized, window.location.href).toString()];
          } catch {
            return [normalized];
          }
        })
        .filter((value): value is string => Boolean(value))
        .filter((value) =>
          /payecom\.ru|platiecom\.ru|id\.sber\.ru|sberid|orderid=|bankinvoiceid=|mdorder=|merchantorderid=|merchantordernumber=|formurl=|purchase\/ppd/i.test(
            value
          )
        )
        .filter((value, index, all) => all.indexOf(value) === index)
        .slice(0, 24);

      const lowerTexts = visibleTexts.join(' ').toLowerCase();
      const buttonTexts = visibleButtons
        .map((button) => `${button.text} ${button.ariaLabel ?? ''}`.trim().toLowerCase())
        .join(' ');
      const hasSearchSignals = /search|найти|поиск|каталог|catalog|корзин|my books|мои книги/.test(lowerTexts);
      const hasAuthWords = /sign in|log in|войти|password|пароль/.test(lowerTexts);
      const hasSearchForm = forms.some((form) => (form.action ?? '').toLowerCase().includes('/search'));
      const hasLikelyAuthForm = forms.some((form) => form.inputCount >= 2 && !((form.action ?? '').toLowerCase().includes('/search')));

      const currentUrl = window.location.href;
      const urlHasSearch = /[?&]q=|\/search/i.test(currentUrl);
      const urlHasCart = /\/cart|\/basket|\/my-books\/cart/i.test(currentUrl);
      const urlHasProduct = /\/book\/|\/audiobook\/|\/product\//i.test(currentUrl);

      const hasBuyButtons = /buy|add to cart|purchase|купить|в корзину/.test(buttonTexts);
      // Strong cart signals: confirmation text or navigational cue to cart — not just nav badge
      const hasCartConfirmation = /added to cart|go to cart|перейти в корзину|товар добавлен|добавлено в корзину/i.test(lowerTexts + ' ' + buttonTexts);

      let pageSignatureGuess = 'unknown';
      if (hasLikelyAuthForm || (hasAuthWords && !hasSearchSignals)) {
        pageSignatureGuess = 'auth_form';
      } else if (urlHasCart || hasCartConfirmation) {
        pageSignatureGuess = 'cart';
      } else if (urlHasProduct || hasBuyButtons) {
        pageSignatureGuess = 'product_page';
      } else if (!hasBuyButtons && /cart|basket|checkout|корзин/.test(lowerTexts) && !urlHasSearch) {
        pageSignatureGuess = 'cart';
      } else if (urlHasSearch || /search|results|найден|результат/.test(lowerTexts)) {
        pageSignatureGuess = 'search_results';
      } else if (hasSearchSignals || hasSearchForm) {
        pageSignatureGuess = 'home';
      } else if (visibleTexts.length > 0) {
        pageSignatureGuess = 'content_page';
      }

      return {
        visibleTexts,
        visibleButtons,
        forms,
        urlHints,
        pageSignatureGuess
      };
    })) as ObserveSummary;

    await this.persistStorageState();

    const state = {
      url: page.url(),
      title: await page.title(),
      readyState: await page.evaluate(() => document.readyState),
      viewport: page.viewportSize() ?? { width: 0, height: 0 },
      ...summary
    };

    return {
      ...state,
      paymentContext: extractPaymentContext(state)
    };
  }

  async snapshot(): Promise<BrowserSessionSnapshotResult> {
    const page = this.requirePage();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const paths = await capturePageSnapshot(page, this.options.snapshotRootDir, this.options.sessionId);
    await this.persistStorageState();
    return {
      ...paths,
      state: await this.observe()
    };
  }

  async close(): Promise<void> {
    await this.pageInstance?.close().catch(() => undefined);
    if (!this.contextLease) {
      await this.context?.close().catch(() => undefined);
      await this.browser?.close().catch(() => undefined);
      this.stopCamoufoxBrowser?.();
    } else {
      this.contextLease.release();
    }
    this.pageInstance = null;
    this.context = null;
    this.browser = null;
    this.contextLease = null;
    this.stopCamoufoxBrowser = null;
  }

  private requirePage(): Page {
    if (!this.pageInstance) {
      throw new BrowserPlatformError('Session page is not initialized', { code: 'SESSION_NOT_READY' });
    }

    return this.pageInstance;
  }
}
