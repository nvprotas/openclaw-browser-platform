import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { BrowserPlatformError } from '../core/errors.js';
import { PlaywrightController } from '../playwright/controller.js';
import { matchSitePackByUrl } from '../packs/loader.js';
import { detectLoginGate } from '../helpers/login-gates.js';
import { getDefaultStateStore } from './state-store.js';
import { runIntegratedLitresBootstrap, type LitresBootstrapAttemptResult } from './litres-auth.js';
import { resolveProfileForSession } from './profile-state.js';
import { resolveBackendForSession } from './backend-policy.js';
import { runIntegratedKuperBootstrap } from './kuper-auth.js';
import { DEFAULT_SESSION_IDLE_TIMEOUT_MS, SessionRegistry } from './session-registry.js';
import { buildHardStopSignal } from '../helpers/hard-stop.js';
import { isDebugEnabled, appendDebugLog } from '../debug/capture.js';
import { StateStore } from './state-store.js';
import { SESSION_BACKENDS } from './types.js';
import type {
  DaemonInfo,
  DaemonStatusResponse,
  SessionActionPayload,
  SessionActionResult,
  SessionBackend,
  SessionObservation,
  SessionSnapshot,
  TimingEntry
} from './types.js';

const VERSION = '0.1.0';
const SESSION_IDLE_TIMEOUT_ENV = 'BROWSER_PLATFORM_SESSION_IDLE_TIMEOUT_MS';
const DEFAULT_SESSION_JANITOR_INTERVAL_MS = 60_000;
export function isSessionBackend(value: unknown): value is SessionBackend {
  return typeof value === 'string' && SESSION_BACKENDS.includes(value as SessionBackend);
}

function isoNow(): string {
  return new Date().toISOString();
}

export function resolveSessionIdleTimeoutMs(env: NodeJS.ProcessEnv = process.env, override?: number): number {
  if (override !== undefined) {
    return override > 0 ? override : DEFAULT_SESSION_IDLE_TIMEOUT_MS;
  }

  const raw = env[SESSION_IDLE_TIMEOUT_ENV]?.trim();
  if (!raw) {
    return DEFAULT_SESSION_IDLE_TIMEOUT_MS;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SESSION_IDLE_TIMEOUT_MS;
}

function createTimingCollector() {
  const stages: TimingEntry[] = [];

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
    },
    skip(step: string, detail: string): void {
      const now = isoNow();
      stages.push({
        step,
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        status: 'skipped',
        detail
      });
    }
  };
}

function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json');
  response.end(`${JSON.stringify(payload)}\n`);
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function toErrorResponse(
  error: unknown
): { statusCode: number; payload: { ok: false; error: { message: string; code?: string; details?: Record<string, unknown> } } } {
  if (error instanceof BrowserPlatformError) {
    const statusCode =
      error.code === 'SESSION_NOT_FOUND' ? 404 : error.code === 'SESSION_OPEN_FAILED' ? 500 : 400;
    return {
      statusCode,
      payload: {
        ok: false,
        error: {
          message: error.message,
          code: error.code,
          details: error.details
        }
      }
    };
  }

  return {
    statusCode: 500,
    payload: {
      ok: false,
      error: {
        message: error instanceof Error ? error.message : 'Unknown server error'
      }
    }
  };
}

type StartDaemonServerOptions = {
  sessionIdleTimeoutMs?: number;
  sessionJanitorIntervalMs?: number;
  registry?: SessionRegistry;
  stateStore?: StateStore;
  controller?: PlaywrightController;
};

export async function runSessionJanitorPass(registry: SessionRegistry, controller: Pick<PlaywrightController, 'closeSession'>): Promise<void> {
  const expiredSessionIds = registry.findExpiredSessionIds();
  await Promise.all(
    expiredSessionIds.map(async (sessionId) => {
      await controller.closeSession(sessionId);
      registry.close(sessionId, 'idle_timeout');
      registry.remove(sessionId);
    })
  );
}

export function createSessionJanitorRunner(
  registry: SessionRegistry,
  controller: Pick<PlaywrightController, 'closeSession'>
): () => Promise<void> {
  let janitorPassPromise: Promise<void> | null = null;

  return async () => {
    if (janitorPassPromise) {
      await janitorPassPromise;
      return;
    }

    janitorPassPromise = runSessionJanitorPass(registry, controller);
    try {
      await janitorPassPromise;
    } finally {
      janitorPassPromise = null;
    }
  };
}

export async function startDaemonServer(options: StartDaemonServerOptions = {}): Promise<DaemonInfo> {
  const sessionIdleTimeoutMs = resolveSessionIdleTimeoutMs(process.env, options.sessionIdleTimeoutMs);
  const registry = options.registry ?? new SessionRegistry({ defaultIdleTimeoutMs: sessionIdleTimeoutMs });
  const stateStore = options.stateStore ?? getDefaultStateStore();
  const controller = options.controller ?? new PlaywrightController(stateStore.root);
  const token = randomBytes(24).toString('hex');
  const startedAt = new Date().toISOString();

  const closeAndForgetSession = async (
    sessionId: string,
    reason: 'manual' | 'idle_timeout' | 'open_failed' | 'controller_missing' | 'shutdown'
  ): Promise<void> => {
    await controller.closeSession(sessionId);
    registry.close(sessionId, reason);
    registry.remove(sessionId);
  };

  const janitorIntervalMs = options.sessionJanitorIntervalMs ?? DEFAULT_SESSION_JANITOR_INTERVAL_MS;
  const runJanitorPassSafely = createSessionJanitorRunner(registry, controller);
  let janitorPassPromise: Promise<void> | null = null;
  const janitor = setInterval(() => {
    janitorPassPromise = runJanitorPassSafely();
    void janitorPassPromise.catch(() => undefined);
  }, janitorIntervalMs);
  janitor.unref();

  const server = http.createServer(async (request, response) => {
    const auth = request.headers.authorization;
    if (auth !== `Bearer ${token}`) {
      sendJson(response, 401, { ok: false, error: { message: 'Unauthorized' } });
      return;
    }

    const requestStartMs = Date.now();
    let logSessionId: string | null = null;
    let logPayloadSummary: Record<string, unknown> | null = null;

    response.on('finish', () => {
      if (!isDebugEnabled()) return;
      void appendDebugLog(stateStore.root, {
        source: 'agent',
        event: 'request',
        method: request.method,
        route: request.url,
        sessionId: logSessionId,
        payload: logPayloadSummary,
        statusCode: response.statusCode,
        durationMs: Date.now() - requestStartMs
      });
    });

    try {
      if (request.method === 'GET' && request.url === '/v1/daemon/status') {
        const payload: DaemonStatusResponse = {
          ok: true,
          daemon: {
            pid: process.pid,
            port: (server.address() as { port: number }).port,
            startedAt,
            uptimeMs: Math.round(process.uptime() * 1000),
            sessionCount: registry.countOpen(),
            version: VERSION
          }
        };
        sendJson(response, 200, payload);
        return;
      }

      if (request.method === 'POST' && request.url === '/v1/session/open') {
        const requestStartedAt = isoNow();
        const requestStartedMs = Date.now();
        const timing = createTimingCollector();
        const body = (await readJsonBody(request)) as {
          url?: string;
          storageStatePath?: string;
          backend?: SessionBackend;
          profileId?: string;
          scenarioId?: string;
        };
        logPayloadSummary = { url: body?.url ?? null, profileId: body?.profileId ?? null, scenarioId: body?.scenarioId ?? null };
        if (!body?.url) {
          sendJson(response, 400, { ok: false, error: { message: 'Missing url' } });
          return;
        }
        const requestedUrl = body.url;

        if (body.backend !== undefined && body.backend !== null) {
          if (!isSessionBackend(body.backend)) {
            sendJson(response, 400, {
              ok: false,
              error: {
                message: `Invalid backend. Allowed values: ${SESSION_BACKENDS.join(', ')}`
              }
            });
            return;
          }
          console.warn('[daemon] POST /v1/session/open: body.backend is a debug hint and is ignored; backend is selected by policy');
        }

        const preMatchedPack = await timing.run('match_site_pack_pre', () => matchSitePackByUrl(requestedUrl), requestedUrl);
        const backendPolicy = resolveBackendForSession({
          requestedUrl,
          matchedPack: preMatchedPack,
          profileId: body.profileId,
          scenarioId: body.scenarioId
        });
        const backend: SessionBackend = backendPolicy.selectedBackend;
        logPayloadSummary = {
          ...logPayloadSummary,
          selectedBackend: backendPolicy.selectedBackend,
          matchedRule: backendPolicy.matchedRule
        };
        const profile = await timing.run(
          'resolve_profile',
          () =>
            resolveProfileForSession({
              stateRootDir: stateStore.root,
              backend,
              requestedUrl,
              explicitStorageStatePath: body.storageStatePath,
              profileId: body.profileId,
              matchedPack: preMatchedPack
            }),
          body.profileId ?? null
        );

        const record = registry.open({
          url: requestedUrl,
          backend,
          scenarioId: body.scenarioId ?? null,
          idleTimeoutMs: sessionIdleTimeoutMs,
          profileContext: {
            profileId: profile.profileId,
            persistent: profile.persistent,
            source: profile.source,
            storageStatePath: profile.storageStatePath,
            storageStateExists: profile.storageStateExists
          }
        });
        try {
          const openWithStatePath = profile.storageStateExists ? profile.storageStatePath ?? undefined : undefined;
          let opened = await timing.run(
            'open_session_initial',
            () =>
              controller.openSession(record.sessionId, requestedUrl, {
                storageStatePath: openWithStatePath,
                backend
              }),
            openWithStatePath ?? null
          );
          let matchedPack = await timing.run('match_site_pack_opened_initial', () => matchSitePackByUrl(opened.url), opened.url);
          let observed = await timing.run('observe_session_initial', () => controller.observeSession(record.sessionId));
          let auth = detectLoginGate(opened.url, observed);
          const needsLitresBootstrap = matchedPack?.summary.siteId === 'litres' && auth.state !== 'authenticated';
          const bootstrapResult: LitresBootstrapAttemptResult =
            needsLitresBootstrap
              ? await timing.run(
                  'bootstrap_litres',
                  () =>
                    runIntegratedLitresBootstrap({
                      matchedPack: matchedPack!,
                      storageStatePath: profile.storageStatePath,
                      // Reuse the existing session page to avoid launching a fresh Camoufox that
                      // gets blocked by DDoS Guard on litres.ru.
                      existingPage: controller.getSessionPage(record.sessionId)
                    }),
                  profile.storageStatePath ?? null
                )
              : matchedPack?.summary.siteId === 'kuper' && auth.state !== 'authenticated' && !profile.storageStateExists
                ? await timing.run(
                    'bootstrap_kuper',
                    () =>
                      runIntegratedKuperBootstrap({
                        storageStatePath: profile.storageStatePath
                      }),
                    profile.storageStatePath ?? null
                  )
                : {
                    attempted: false,
                    ok: false,
                    status: profile.storageStateExists ? 'reused_existing_state' : 'not_attempted',
                    handoffRequired: false,
                    redirectedToSberId: false,
                    bootstrapFailed: false,
                    usedExistingPage: false,
                    scriptPath: null,
                    statePath: profile.storageStatePath,
                    outDir: null,
                    finalUrl: null,
                    rawStatus: null,
                    errorMessage: null,
                    durationMs: 0,
                    timeline: []
                  };
          if (!bootstrapResult.attempted) {
            timing.skip('bootstrap_skipped', profile.storageStateExists ? 'existing_storage_state' : 'not_applicable');
          }

          const refreshedStatePath = bootstrapResult.statePath ?? profile.storageStatePath;
          const refreshedStateExists = profile.storageStateExists || (bootstrapResult.ok && Boolean(refreshedStatePath));

          if (bootstrapResult.attempted && bootstrapResult.usedExistingPage && (bootstrapResult.ok || bootstrapResult.handoffRequired)) {
            // Bootstrap ran on the existing session page. The session browser already navigated
            // through the auth flow. Re-observe the current page state without closing/reopening.
            observed = await timing.run('observe_session_after_bootstrap', () => controller.observeSession(record.sessionId));
            opened = { url: observed.url, title: observed.title };
            matchedPack = await timing.run('match_site_pack_after_bootstrap', () => matchSitePackByUrl(opened.url), opened.url);
            auth = detectLoginGate(opened.url, observed);
          } else if (bootstrapResult.attempted && bootstrapResult.adoptedSession) {
            opened = await timing.run(
              'adopt_bootstrap_session',
              () =>
                controller.adoptSession(record.sessionId, bootstrapResult.adoptedSession!, {
                  storageStatePath: refreshedStatePath ?? undefined,
                  backend
                }),
              refreshedStatePath ?? null
            );
            matchedPack = await timing.run('match_site_pack_adopted', () => matchSitePackByUrl(opened.url), opened.url);
            observed = await timing.run('observe_session_adopted', () => controller.observeSession(record.sessionId));
            auth = detectLoginGate(opened.url, observed);
          } else if (bootstrapResult.attempted && refreshedStatePath && (bootstrapResult.ok || bootstrapResult.handoffRequired)) {
            await timing.run('close_session_before_reopen', () => controller.closeSession(record.sessionId));
            opened = await timing.run(
              'open_session_rehydrated',
              () =>
                controller.openSession(record.sessionId, requestedUrl, {
                  storageStatePath: refreshedStatePath,
                  backend
                }),
              refreshedStatePath
            );
            matchedPack = await timing.run('match_site_pack_opened_rehydrated', () => matchSitePackByUrl(opened.url), opened.url);
            observed = await timing.run('observe_session_rehydrated', () => controller.observeSession(record.sessionId));
            auth = detectLoginGate(opened.url, observed);
          } else {
            timing.skip('reopen_after_bootstrap', 'not_needed');
          }

          const effectivePack = matchedPack ?? preMatchedPack;
          const session =
            registry.touch(record.sessionId, {
              url: opened.url,
              title: opened.title,
              profileContext: {
                ...record.profileContext,
                storageStatePath: refreshedStatePath,
                storageStateExists: refreshedStateExists
              },
              packContext: effectivePack
                ? {
                    matchedPack: true,
                    siteId: effectivePack.summary.siteId,
                    supportLevel: effectivePack.summary.supportLevel,
                    matchedDomain: effectivePack.summary.matchedDomain,
                    startUrl: effectivePack.summary.startUrl,
                    flows: effectivePack.summary.flows,
                    knownRisks: effectivePack.summary.riskFlags,
                    instructionsSummary: effectivePack.instructionsSummary,
                    knownSignals: effectivePack.knownSignals
                  }
                : record.packContext,
              authContext: {
                state: auth.state,
                loginGateDetected: auth.loginGateDetected,
                bootstrapAttempted: Boolean(profile.source) || bootstrapResult.attempted,
                bootstrapSource: profile.source,
                storageStatePath: refreshedStatePath,
                storageStateExists: refreshedStateExists,
                authenticatedSignals: auth.authenticatedSignals,
                anonymousSignals: auth.anonymousSignals,
                handoffRequired: bootstrapResult.handoffRequired,
                bootstrapFailed: bootstrapResult.bootstrapFailed,
                redirectedToSberId: bootstrapResult.redirectedToSberId,
                bootstrapStatus: bootstrapResult.status,
                bootstrapScriptPath: bootstrapResult.scriptPath,
                bootstrapOutDir: bootstrapResult.outDir,
                bootstrapFinalUrl: bootstrapResult.finalUrl,
                bootstrapError: bootstrapResult.errorMessage,
                bootstrapDurationMs: bootstrapResult.durationMs ?? null,
                bootstrapTimeline: bootstrapResult.timeline ?? []
              },
              paymentContext: observed.paymentContext
            }) ?? record;
          const trace = await controller.writeTrace(record.sessionId, 'session-open', {
            sessionId: record.sessionId,
            requestedUrl,
            timing: {
              startedAt: requestStartedAt,
              finishedAt: isoNow(),
              durationMs: Date.now() - requestStartedMs,
              stages: timing.stages
            },
            opened,
            openTiming: opened.timing ?? null,
            packContext: session.packContext,
            authContext: session.authContext,
            paymentContext: session.paymentContext,
            observedAt: new Date().toISOString(),
            page: observed
          });
          sendJson(response, 200, { ok: true, session: { ...session, trace } });
        } catch (error) {
          await closeAndForgetSession(record.sessionId, 'open_failed');
          throw error;
        }
        return;
      }

      if (request.method === 'POST' && request.url === '/v1/session/context') {
        const body = (await readJsonBody(request)) as { sessionId?: string };
        logSessionId = body?.sessionId ?? null;
        const session = body?.sessionId ? registry.get(body.sessionId) : undefined;
        if (!session) {
          throw new BrowserPlatformError('Session not found', { code: 'SESSION_NOT_FOUND' });
        }

        sendJson(response, 200, { ok: true, session: registry.touchUsage(session.sessionId) ?? session });
        return;
      }

      if (request.method === 'POST' && request.url === '/v1/session/observe') {
        const body = (await readJsonBody(request)) as { sessionId?: string };
        logSessionId = body?.sessionId ?? null;
        const session = body?.sessionId ? registry.get(body.sessionId) : undefined;
        if (!session) {
          throw new BrowserPlatformError('Session not found', { code: 'SESSION_NOT_FOUND' });
        }

        registry.touchUsage(session.sessionId);
        let observed;
        try {
          observed = await controller.observeSession(session.sessionId);
        } catch (err) {
          if (err instanceof BrowserPlatformError && err.code === 'SESSION_NOT_FOUND') {
            await closeAndForgetSession(session.sessionId, 'controller_missing');
          }
          throw err;
        }
        const auth = detectLoginGate(observed.url, observed);
        registry.touchUsage(session.sessionId, {
          url: observed.url,
          title: observed.title,
          authContext: {
            ...session.authContext,
            state: auth.state,
            loginGateDetected: auth.loginGateDetected,
            authenticatedSignals: auth.authenticatedSignals,
            anonymousSignals: auth.anonymousSignals
          },
          paymentContext: observed.paymentContext
        });
        const payload: SessionObservation = {
          sessionId: session.sessionId,
          observedAt: new Date().toISOString(),
          ...observed,
          hardStop: buildHardStopSignal(observed.url, observed.paymentContext) ?? undefined
        };
        payload.trace = await controller.writeTrace(session.sessionId, 'observe', payload);
        sendJson(response, 200, { ok: true, session: payload });
        return;
      }

      if (request.method === 'POST' && request.url === '/v1/session/act') {
        const body = (await readJsonBody(request)) as { sessionId?: string; payload?: SessionActionPayload };
        logSessionId = body?.sessionId ?? null;
        logPayloadSummary = body?.payload ? { action: body.payload.action } : null;
        const session = body?.sessionId ? registry.get(body.sessionId) : undefined;
        if (!session) {
          throw new BrowserPlatformError('Session not found', { code: 'SESSION_NOT_FOUND' });
        }
        if (!body?.payload) {
          throw new BrowserPlatformError('Missing action payload', { code: 'INVALID_ACTION_PAYLOAD' });
        }

        // Hard-stop enforcement: if session is in terminal extraction state, block further actions.
        // The agent must return the extractionJson and must not continue browsing.
        const terminalContext = session.paymentContext;
        if ((terminalContext.terminalExtractionResult || terminalContext.shouldReportImmediately) && terminalContext.extractionJson) {
          const hardStop = buildHardStopSignal(session.url, terminalContext);
          sendJson(response, 409, {
            ok: false,
            code: 'HARD_STOP_TERMINAL_EXTRACTION_RESULT',
            message: 'Session is in terminal extraction state. Return hardStop.finalPayload to the user and do not continue browsing.',
            hardStop
          });
          return;
        }

        registry.touchUsage(session.sessionId);
        let action;
        try {
          action = await controller.actInSession(session.sessionId, body.payload);
        } catch (err) {
          if (err instanceof BrowserPlatformError && err.code === 'SESSION_NOT_FOUND') {
            await closeAndForgetSession(session.sessionId, 'controller_missing');
          }
          throw err;
        }
        const auth = detectLoginGate(action.after.url, action.after);
        registry.touchUsage(session.sessionId, {
          url: action.after.url,
          title: action.after.title,
          authContext: {
            ...session.authContext,
            state: auth.state,
            loginGateDetected: auth.loginGateDetected,
            authenticatedSignals: auth.authenticatedSignals,
            anonymousSignals: auth.anonymousSignals
          },
          paymentContext: action.after.paymentContext
        });
        const hardStop = buildHardStopSignal(action.after.url, action.after.paymentContext);
        const payload: SessionActionResult = {
          sessionId: session.sessionId,
          actedAt: new Date().toISOString(),
          action: action.action,
          target: action.target,
          input: action.input,
          before: {
            sessionId: session.sessionId,
            observedAt: new Date().toISOString(),
            ...action.before,
            hardStop: buildHardStopSignal(action.before.url, action.before.paymentContext) ?? undefined
          },
          after: {
            sessionId: session.sessionId,
            observedAt: new Date().toISOString(),
            ...action.after,
            hardStop: hardStop ?? undefined
          },
          changes: action.changes,
          observations: action.observations,
          hardStop: hardStop ?? undefined
        };
        payload.trace = await controller.writeTrace(session.sessionId, `act-${action.action}`,
          payload
        );
        sendJson(response, 200, { ok: true, action: payload });
        return;
      }

      if (request.method === 'POST' && request.url === '/v1/session/snapshot') {
        const body = (await readJsonBody(request)) as { sessionId?: string };
        logSessionId = body?.sessionId ?? null;
        const session = body?.sessionId ? registry.get(body.sessionId) : undefined;
        if (!session) {
          throw new BrowserPlatformError('Session not found', { code: 'SESSION_NOT_FOUND' });
        }

        registry.touchUsage(session.sessionId);
        const snapshotResult = await controller.snapshotSession(session.sessionId);
        const auth = detectLoginGate(snapshotResult.state.url, snapshotResult.state);
        registry.touchUsage(session.sessionId, {
          url: snapshotResult.state.url,
          title: snapshotResult.state.title,
          authContext: {
            ...session.authContext,
            state: auth.state,
            loginGateDetected: auth.loginGateDetected,
            authenticatedSignals: auth.authenticatedSignals,
            anonymousSignals: auth.anonymousSignals
          },
          paymentContext: snapshotResult.state.paymentContext
        });
        const hardStop = buildHardStopSignal(snapshotResult.state.url, snapshotResult.state.paymentContext);
        const snapshot: SessionSnapshot = {
          sessionId: session.sessionId,
          capturedAt: new Date().toISOString(),
          rootDir: snapshotResult.rootDir,
          screenshotPath: snapshotResult.screenshotPath,
          htmlPath: snapshotResult.htmlPath,
          state: {
            sessionId: session.sessionId,
            observedAt: new Date().toISOString(),
            ...snapshotResult.state,
            hardStop: hardStop ?? undefined
          },
          hardStop: hardStop ?? undefined
        };
        snapshot.trace = await controller.writeTrace(session.sessionId, 'snapshot', snapshot);
        sendJson(response, 200, { ok: true, snapshot });
        return;
      }

      if (request.method === 'POST' && request.url === '/v1/session/close') {
        const body = (await readJsonBody(request)) as { sessionId?: string };
        logSessionId = body?.sessionId ?? null;
        const session = body?.sessionId ? registry.get(body.sessionId) : undefined;
        if (!session) {
          throw new BrowserPlatformError('Session not found', { code: 'SESSION_NOT_FOUND' });
        }

        const closedSession = registry.close(session.sessionId, 'manual') ?? session;
        await controller.closeSession(session.sessionId);
        registry.remove(session.sessionId);
        sendJson(response, 200, { ok: true, session: closedSession });
        return;
      }

      sendJson(response, 404, { ok: false, error: { message: 'Not found' } });
    } catch (error) {
      const { statusCode, payload } = toErrorResponse(error);
      sendJson(response, statusCode, payload);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const info: DaemonInfo = {
    pid: process.pid,
    port: (server.address() as { port: number }).port,
    token,
    startedAt,
    version: VERSION
  };

  await stateStore.writeDaemonInfo(info);

  const shutdown = async (): Promise<void> => {
    clearInterval(janitor);
    await janitorPassPromise?.catch(() => undefined);
    registry.closeAll('shutdown');
    await controller.closeAll();
    registry.clear();
    server.close();
  };

  process.on('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });

  return info;
}
