import path from 'node:path';
import { BrowserPlatformError } from '../core/errors.js';
import type { SessionActionPayload } from '../daemon/types.js';
import { TraceWriter } from '../traces/writer.js';
import {
  isDebugEnabled,
  captureDebugStep,
  captureDebugStepJson,
  appendDebugLog
} from '../debug/capture.js';
import {
  BrowserContextPool,
  BrowserSession,
  type AdoptedBrowserSession,
  type BrowserSessionOpenResult,
  type BrowserSessionSnapshotResult,
  type PageStateSummary
} from './browser-session.js';
import { buildActionResult, runStep } from '../runtime/run-step.js';
import type { SessionBackend } from '../daemon/types.js';
import type { LoadedSitePack } from '../packs/loader.js';

export class PlaywrightController {
  private readonly sessions = new Map<string, BrowserSession>();
  private readonly sessionOperationTails = new Map<string, Promise<void>>();
  private readonly lastObservations = new Map<
    string,
    { state: PageStateSummary; observedAtMs: number }
  >();
  private readonly traceWriter: TraceWriter;
  private readonly contextPool = new BrowserContextPool();

  constructor(private readonly rootDir: string) {
    this.traceWriter = new TraceWriter(
      path.join(this.rootDir, 'artifacts', 'traces')
    );
  }

  async openSession(
    sessionId: string,
    url: string,
    options?: {
      storageStatePath?: string;
      backend?: SessionBackend;
    }
  ): Promise<BrowserSessionOpenResult> {
    const session = new BrowserSession({
      sessionId,
      snapshotRootDir: path.join(this.rootDir, 'artifacts', 'snapshots'),
      storageStatePath: options?.storageStatePath,
      backend: options?.backend,
      contextPool: options?.storageStatePath ? this.contextPool : undefined
    });

    const opened = await session.open(url);
    session.markUsed();
    this.sessions.set(sessionId, session);
    await this.debugCapture(sessionId, 'open', {
      sessionId,
      url: opened.url,
      title: opened.title
    });
    return opened;
  }

  async observeSession(sessionId: string): Promise<PageStateSummary> {
    return this.runExclusive(sessionId, 'observe', async () => {
      const session = this.requireSession(sessionId);
      session.markUsed();
      const result = await session.observe();
      this.lastObservations.set(sessionId, {
        state: result,
        observedAtMs: Date.now()
      });
      await this.debugCapture(sessionId, 'observe', {
        sessionId,
        url: result.url,
        title: result.title
      });
      return result;
    });
  }

  async adoptSession(
    sessionId: string,
    adopted: AdoptedBrowserSession,
    options?: {
      storageStatePath?: string;
      backend?: SessionBackend;
    }
  ): Promise<BrowserSessionOpenResult> {
    return this.runExclusive(sessionId, 'adopt', async () => {
      await this.closeSessionUnlocked(sessionId);

      const session = new BrowserSession({
        sessionId,
        snapshotRootDir: path.join(this.rootDir, 'artifacts', 'snapshots'),
        storageStatePath: options?.storageStatePath,
        backend: options?.backend
      });

      try {
        session.adoptExisting(adopted);
        session.markUsed();
        await session.persistStorageState({ force: true });
        const page = session.page();
        this.sessions.set(sessionId, session);

        return {
          url: page.url(),
          title: await page.title()
        };
      } catch (error) {
        await session.close().catch(() => undefined);
        throw error;
      }
    });
  }

  async writeTrace(sessionId: string, stepType: string, payload: unknown) {
    return this.traceWriter.writeStep(sessionId, stepType, payload);
  }

  async flushTraces(): Promise<void> {
    await this.traceWriter.flush();
  }

  async actInSession(
    sessionId: string,
    payload: SessionActionPayload,
    options: { sitePack?: LoadedSitePack | null } = {}
  ) {
    return this.runExclusive(sessionId, 'act', async () => {
      const session = this.requireSession(sessionId);
      session.markUsed();
      const cached = this.lastObservations.get(sessionId);
      const beforeFromCache =
        cached && Date.now() - cached.observedAtMs <= 1_000
          ? cached.state
          : undefined;
      const { before, after, observations } = await runStep(session, payload, {
        before: beforeFromCache,
        sitePack: options.sitePack
      });
      this.lastObservations.set(sessionId, {
        state: after,
        observedAtMs: Date.now()
      });
      const result = buildActionResult(payload, before, after, observations);
      await this.debugCapture(sessionId, `act-${payload.action}`, {
        sessionId,
        action: result.action,
        target: result.target,
        input: result.input,
        before: { url: before.url, title: before.title },
        after: { url: after.url, title: after.title },
        changes: result.changes
      });
      return result;
    });
  }

  async snapshotSession(
    sessionId: string
  ): Promise<BrowserSessionSnapshotResult> {
    return this.runExclusive(sessionId, 'snapshot', async () => {
      const session = this.requireSession(sessionId);
      session.markUsed();
      const result = await session.snapshot();
      this.lastObservations.set(sessionId, {
        state: result.state,
        observedAtMs: Date.now()
      });
      if (isDebugEnabled()) {
        await captureDebugStepJson(this.rootDir, sessionId, 'snapshot', {
          sessionId,
          screenshotPath: result.screenshotPath,
          htmlPath: result.htmlPath,
          url: result.state.url,
          title: result.state.title
        });
      }
      return result;
    });
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.runExclusive(sessionId, 'close', async () => {
      await this.closeSessionUnlocked(sessionId);
    });
  }

  async persistSessionStorageState(
    sessionId: string,
    options: { force?: boolean } = {}
  ): Promise<void> {
    await this.runExclusive(sessionId, 'persist-storage-state', async () => {
      const session = this.requireSession(sessionId);
      session.markUsed();
      await session.persistStorageState(options);
    });
  }

  private async closeSessionUnlocked(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    this.sessions.delete(sessionId);
    this.lastObservations.delete(sessionId);
    await session.close();
  }

  private async runExclusive<T>(
    sessionId: string,
    opName: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const queuedAtMs = Date.now();
    const queuedAt = new Date(queuedAtMs).toISOString();
    const previousTail =
      this.sessionOperationTails.get(sessionId) ?? Promise.resolve();
    const operationPromise = previousTail
      .catch(() => undefined)
      .then(async () => {
        const startedAtMs = Date.now();
        const startedAt = new Date(startedAtMs).toISOString();
        let status: 'ok' | 'error' = 'ok';

        try {
          return await fn();
        } catch (error) {
          status = 'error';
          throw error;
        } finally {
          const finishedAtMs = Date.now();
          if (isDebugEnabled()) {
            void appendDebugLog(this.rootDir, {
              source: 'browser',
              event: 'session-operation',
              sessionId,
              opName,
              status,
              queuedAt,
              startedAt,
              finishedAt: new Date(finishedAtMs).toISOString(),
              waitedMs: startedAtMs - queuedAtMs,
              runMs: finishedAtMs - startedAtMs
            });
          }
        }
      });

    const tail = operationPromise.then(
      () => undefined,
      () => undefined
    );
    this.sessionOperationTails.set(sessionId, tail);

    try {
      return await operationPromise;
    } finally {
      if (this.sessionOperationTails.get(sessionId) === tail) {
        this.sessionOperationTails.delete(sessionId);
      }
    }
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async closeAll(): Promise<void> {
    const sessionIds = [...this.sessions.keys()];
    await Promise.all(
      sessionIds.map((sessionId) => this.closeSession(sessionId))
    );
    await this.contextPool.closeAll();
  }

  getSessionPage(sessionId: string): import('playwright').Page | null {
    return this.sessions.get(sessionId)?.page() ?? null;
  }

  private async debugCapture(
    sessionId: string,
    stepName: string,
    meta: unknown
  ): Promise<void> {
    if (!isDebugEnabled()) return;
    const startMs = Date.now();
    const page = this.sessions.get(sessionId)?.page();
    if (!page) return;
    await captureDebugStep(page, this.rootDir, sessionId, stepName, meta);
    await appendDebugLog(this.rootDir, {
      source: 'browser',
      event: stepName,
      sessionId,
      durationMs: Date.now() - startMs,
      ...(meta !== null && typeof meta === 'object'
        ? (meta as Record<string, unknown>)
        : { meta })
    });
  }

  private requireSession(sessionId: string): BrowserSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new BrowserPlatformError('Session not found', {
        code: 'SESSION_NOT_FOUND'
      });
    }

    return session;
  }
}
