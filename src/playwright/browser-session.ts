import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, firefox, type Browser, type BrowserContext, type LaunchOptions, type Page } from 'playwright';
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
}

export interface BrowserSessionSnapshotResult extends SnapshotPaths {
  state: PageStateSummary;
}

const CAMOUFOX_WS_REGEX = /(wss?:\/\/[^\s"'<>]+)|((?:ws|wss):[^\s"'<>]+)/i;

export function extractWebsocketEndpoint(logLine: string): string | null {
  const normalized = logLine.trim();
  if (!normalized) {
    return null;
  }

  const matched = normalized.match(CAMOUFOX_WS_REGEX);
  if (!matched) {
    return null;
  }

  const candidate = (matched[1] ?? matched[2] ?? '').replace(/[\])},;]+$/, '');
  return candidate.startsWith('ws://') || candidate.startsWith('wss://') ? candidate : null;
}

export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pageInstance: Page | null = null;
  private camoufoxProcess: ChildProcess | null = null;

  constructor(private readonly options: BrowserSessionOptions) {}

  async open(url: string): Promise<BrowserSessionOpenResult> {
    const backend = this.options.backend ?? 'chromium';

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      browser = backend === 'camoufox' ? await this.openCamoufoxBrowser() : await chromium.launch({
        headless: true,
        ...this.options.launchOptions
      });

      context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        storageState: this.options.storageStatePath
      });

      page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await waitForInitialLoad(page);
    } catch (error) {
      await context?.close().catch(() => undefined);
      await browser?.close().catch(() => undefined);
      this.stopCamoufoxProcess();

      throw new BrowserPlatformError(`Failed to open browser session (${backend})`, {
        code: 'SESSION_OPEN_FAILED',
        details: {
          backend,
          url,
          cause: error instanceof Error ? error.message : String(error)
        }
      });
    }

    this.browser = browser;
    this.context = context;
    this.pageInstance = page;
    await this.persistStorageState();

    return {
      url: page.url(),
      title: await page.title()
    };
  }

  private async openCamoufoxBrowser(): Promise<Browser> {
    const process = spawn('python', ['-m', 'camoufox', 'server'], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.camoufoxProcess = process;

    const timeoutMs = this.options.camoufoxStartupTimeoutMs ?? 15_000;
    const wsEndpoint = await this.waitForCamoufoxEndpoint(process, timeoutMs);

    try {
      return await firefox.connect(wsEndpoint, { timeout: timeoutMs });
    } catch (error) {
      this.stopCamoufoxProcess();
      throw new BrowserPlatformError('Camoufox started but Playwright Firefox failed to connect', {
        code: 'SESSION_OPEN_FAILED',
        details: {
          wsEndpoint,
          cause: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }

  private async waitForCamoufoxEndpoint(process: ChildProcess, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const recentLogs: string[] = [];
      let settled = false;

      const cleanup = () => {
        settled = true;
        clearTimeout(timeout);
        process.stdout?.off('data', onData);
        process.stderr?.off('data', onData);
        process.off('exit', onExit);
        process.off('error', onError);
      };

      const finishWithError = (message: string): void => {
        if (settled) {
          return;
        }
        cleanup();
        this.stopCamoufoxProcess();
        reject(new BrowserPlatformError(message, {
          code: 'SESSION_OPEN_FAILED',
          details: {
            recentLogs: recentLogs.slice(-10)
          }
        }));
      };

      const onData = (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        for (const rawLine of text.split(/\r?\n/)) {
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

      process.stdout?.on('data', onData);
      process.stderr?.on('data', onData);
      process.once('exit', onExit);
      process.once('error', onError);
    });
  }

  private stopCamoufoxProcess(): void {
    if (!this.camoufoxProcess) {
      return;
    }

    if (!this.camoufoxProcess.killed) {
      this.camoufoxProcess.kill('SIGTERM');
    }

    this.camoufoxProcess = null;
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
      const selectors = 'h1, h2, h3, main p, article p, [role="heading"], button, a, label';
      const textCandidates = Array.from(document.querySelectorAll<HTMLElement>(selectors))
        .filter((element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        })
        .map((element) => normalizeText(element.innerText || element.textContent))
        .filter((text) => text.length >= 3);

      const visibleTexts = Array.from(new Set(textCandidates)).slice(0, 12);

      const visibleButtons = Array.from(
        document.querySelectorAll<HTMLElement>('button, input[type="button"], input[type="submit"], [role="button"]')
      )
        .filter((element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        })
        .map((element) => {
          const inputType = element instanceof HTMLInputElement ? element.type : null;
          const text = normalizeText(
            element instanceof HTMLInputElement ? element.value : element.innerText || element.textContent
          );
          const ariaLabel = normalizeText(element.getAttribute('aria-label')) || null;
          return {
            text,
            role: element.getAttribute('role') ?? element.tagName.toLowerCase(),
            type: inputType,
            ariaLabel
          };
        })
        .filter((button) => button.text.length > 0 || button.ariaLabel)
        .slice(0, 8);

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

      let pageSignatureGuess = 'unknown';
      if (hasLikelyAuthForm || (hasAuthWords && !hasSearchSignals)) {
        pageSignatureGuess = 'auth_form';
      } else if (/buy|add to cart|purchase|купить|в корзину/.test(buttonTexts)) {
        pageSignatureGuess = 'product_page';
      } else if (/cart|basket|checkout|корзин/.test(lowerTexts)) {
        pageSignatureGuess = 'cart';
      } else if (/search|results|найден|результат/.test(lowerTexts)) {
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
    const paths = await capturePageSnapshot(page, this.options.snapshotRootDir, this.options.sessionId);
    await this.persistStorageState();
    return {
      ...paths,
      state: await this.observe()
    };
  }

  async close(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
    this.stopCamoufoxProcess();
    this.pageInstance = null;
    this.context = null;
    this.browser = null;
  }

  private requirePage(): Page {
    if (!this.pageInstance) {
      throw new BrowserPlatformError('Session page is not initialized', { code: 'SESSION_NOT_READY' });
    }

    return this.pageInstance;
  }
}
