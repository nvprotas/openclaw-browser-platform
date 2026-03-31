import { chromium, type Browser, type BrowserContext, type LaunchOptions, type Page } from 'playwright';
import { BrowserPlatformError } from '../core/errors.js';
import type { ObserveSummary } from './dom-utils.js';
import { capturePageSnapshot, type SnapshotPaths } from './snapshots.js';
import { waitForInitialLoad } from './waits.js';

export interface BrowserSessionOptions {
  sessionId: string;
  snapshotRootDir: string;
  launchOptions?: LaunchOptions;
  storageStatePath?: string;
}

export interface PageStateSummary extends ObserveSummary {
  url: string;
  title: string;
  readyState: string;
  viewport: {
    width: number;
    height: number;
  };
}

export interface BrowserSessionOpenResult {
  url: string;
  title: string;
}

export interface BrowserSessionSnapshotResult extends SnapshotPaths {
  state: PageStateSummary;
}

export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pageInstance: Page | null = null;

  constructor(private readonly options: BrowserSessionOptions) {}

  async open(url: string): Promise<BrowserSessionOpenResult> {
    const browser = await chromium.launch({
      headless: true,
      ...this.options.launchOptions
    });

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      storageState: this.options.storageStatePath
    });

    const page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await waitForInitialLoad(page);
    } catch (error) {
      await browser.close();
      throw new BrowserPlatformError('Failed to open browser session', {
        code: 'SESSION_OPEN_FAILED',
        details: {
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
        pageSignatureGuess
      };
    })) as ObserveSummary;

    await this.persistStorageState();

    return {
      url: page.url(),
      title: await page.title(),
      readyState: await page.evaluate(() => document.readyState),
      viewport: page.viewportSize() ?? { width: 0, height: 0 },
      ...summary
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
