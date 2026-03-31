import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { BrowserPlatformError } from '../core/errors.js';
import { PlaywrightController } from '../playwright/controller.js';
import { matchSitePackByUrl } from '../packs/loader.js';
import { detectLoginGate } from '../helpers/login-gates.js';
import { getDefaultStateStore } from './state-store.js';
import {
  resolveStorageStateForSession,
  runIntegratedLitresBootstrap,
  type LitresBootstrapAttemptResult
} from './litres-auth.js';
import { SessionRegistry } from './session-registry.js';
import type {
  DaemonInfo,
  DaemonStatusResponse,
  SessionActionPayload,
  SessionActionResult,
  SessionObservation,
  SessionSnapshot
} from './types.js';

const VERSION = '0.1.0';

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

function toErrorResponse(error: unknown): { statusCode: number; payload: { ok: false; error: { message: string; code?: string } } } {
  if (error instanceof BrowserPlatformError) {
    const statusCode =
      error.code === 'SESSION_NOT_FOUND' ? 404 : error.code === 'SESSION_OPEN_FAILED' ? 500 : 400;
    return {
      statusCode,
      payload: {
        ok: false,
        error: {
          message: error.message,
          code: error.code
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

export async function startDaemonServer(): Promise<DaemonInfo> {
  const registry = new SessionRegistry();
  const stateStore = getDefaultStateStore();
  const controller = new PlaywrightController(stateStore.root);
  const token = randomBytes(24).toString('hex');
  const startedAt = new Date().toISOString();

  const server = http.createServer(async (request, response) => {
    const auth = request.headers.authorization;
    if (auth !== `Bearer ${token}`) {
      sendJson(response, 401, { ok: false, error: { message: 'Unauthorized' } });
      return;
    }

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
        const body = (await readJsonBody(request)) as { url?: string; storageStatePath?: string };
        if (!body?.url) {
          sendJson(response, 400, { ok: false, error: { message: 'Missing url' } });
          return;
        }

        const preMatchedPack = await matchSitePackByUrl(body.url);
        const bootstrap = await resolveStorageStateForSession({
          requestedUrl: body.url,
          explicitStorageStatePath: body.storageStatePath,
          matchedPack: preMatchedPack
        });

        const record = registry.open({ url: body.url });
        try {
          const openWithStatePath = bootstrap.storageStateExists ? bootstrap.storageStatePath ?? undefined : undefined;
          let opened = await controller.openSession(record.sessionId, body.url, {
            storageStatePath: openWithStatePath
          });
          let matchedPack = await matchSitePackByUrl(opened.url);
          let observed = await controller.observeSession(record.sessionId);
          let auth = detectLoginGate(opened.url, observed);
          const bootstrapResult: LitresBootstrapAttemptResult =
            matchedPack?.summary.siteId === 'litres' && auth.state !== 'authenticated'
              ? await runIntegratedLitresBootstrap({
                  matchedPack,
                  storageStatePath: bootstrap.storageStatePath
                })
              : {
                  attempted: false,
                  ok: false,
                  status: bootstrap.storageStateExists ? 'reused_existing_state' : 'not_attempted',
                  handoffRequired: false,
                  redirectedToSberId: false,
                  bootstrapFailed: false,
                  scriptPath: null,
                  statePath: bootstrap.storageStatePath,
                  outDir: null,
                  finalUrl: null,
                  rawStatus: null,
                  errorMessage: null
                };

          const refreshedStatePath = bootstrapResult.statePath ?? bootstrap.storageStatePath;
          const refreshedStateExists = bootstrap.storageStateExists || (bootstrapResult.ok && Boolean(refreshedStatePath));

          if (bootstrapResult.attempted && refreshedStatePath && (bootstrapResult.ok || bootstrapResult.handoffRequired)) {
            await controller.closeSession(record.sessionId);
            opened = await controller.openSession(record.sessionId, body.url, {
              storageStatePath: refreshedStatePath
            });
            matchedPack = await matchSitePackByUrl(opened.url);
            observed = await controller.observeSession(record.sessionId);
            auth = detectLoginGate(opened.url, observed);
          }

          const session =
            registry.touch(record.sessionId, {
              url: opened.url,
              title: opened.title,
              packContext: matchedPack
                ? {
                    matchedPack: true,
                    siteId: matchedPack.summary.siteId,
                    supportLevel: matchedPack.summary.supportLevel,
                    matchedDomain: matchedPack.summary.matchedDomain,
                    startUrl: matchedPack.summary.startUrl,
                    flows: matchedPack.summary.flows,
                    knownRisks: matchedPack.summary.riskFlags,
                    instructionsSummary: matchedPack.instructionsSummary,
                    knownSignals: matchedPack.knownSignals
                  }
                : record.packContext,
              authContext: {
                state: auth.state,
                loginGateDetected: auth.loginGateDetected,
                bootstrapAttempted: bootstrap.bootstrapAttempted || bootstrapResult.attempted,
                bootstrapSource: bootstrap.bootstrapSource,
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
                bootstrapError: bootstrapResult.errorMessage
              },
              paymentContext: observed.paymentContext
            }) ?? record;
          sendJson(response, 200, { ok: true, session });
        } catch (error) {
          registry.close(record.sessionId);
          throw error;
        }
        return;
      }

      if (request.method === 'POST' && request.url === '/v1/session/context') {
        const body = (await readJsonBody(request)) as { sessionId?: string };
        const session = body?.sessionId ? registry.get(body.sessionId) : undefined;
        if (!session) {
          throw new BrowserPlatformError('Session not found', { code: 'SESSION_NOT_FOUND' });
        }

        sendJson(response, 200, { ok: true, session });
        return;
      }

      if (request.method === 'POST' && request.url === '/v1/session/observe') {
        const body = (await readJsonBody(request)) as { sessionId?: string };
        const session = body?.sessionId ? registry.get(body.sessionId) : undefined;
        if (!session) {
          throw new BrowserPlatformError('Session not found', { code: 'SESSION_NOT_FOUND' });
        }

        const observed = await controller.observeSession(session.sessionId);
        const auth = detectLoginGate(observed.url, observed);
        registry.touch(session.sessionId, {
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
          ...observed
        };
        sendJson(response, 200, { ok: true, session: payload });
        return;
      }

      if (request.method === 'POST' && request.url === '/v1/session/act') {
        const body = (await readJsonBody(request)) as { sessionId?: string; payload?: SessionActionPayload };
        const session = body?.sessionId ? registry.get(body.sessionId) : undefined;
        if (!session) {
          throw new BrowserPlatformError('Session not found', { code: 'SESSION_NOT_FOUND' });
        }
        if (!body?.payload) {
          throw new BrowserPlatformError('Missing action payload', { code: 'INVALID_ACTION_PAYLOAD' });
        }

        const action = await controller.actInSession(session.sessionId, body.payload);
        const auth = detectLoginGate(action.after.url, action.after);
        registry.touch(session.sessionId, {
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
        const payload: SessionActionResult = {
          sessionId: session.sessionId,
          actedAt: new Date().toISOString(),
          action: action.action,
          target: action.target,
          input: action.input,
          before: {
            sessionId: session.sessionId,
            observedAt: new Date().toISOString(),
            ...action.before
          },
          after: {
            sessionId: session.sessionId,
            observedAt: new Date().toISOString(),
            ...action.after
          },
          changes: action.changes,
          observations: action.observations
        };
        sendJson(response, 200, { ok: true, action: payload });
        return;
      }

      if (request.method === 'POST' && request.url === '/v1/session/snapshot') {
        const body = (await readJsonBody(request)) as { sessionId?: string };
        const session = body?.sessionId ? registry.get(body.sessionId) : undefined;
        if (!session) {
          throw new BrowserPlatformError('Session not found', { code: 'SESSION_NOT_FOUND' });
        }

        const snapshotResult = await controller.snapshotSession(session.sessionId);
        const auth = detectLoginGate(snapshotResult.state.url, snapshotResult.state);
        registry.touch(session.sessionId, {
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
        const snapshot: SessionSnapshot = {
          sessionId: session.sessionId,
          capturedAt: new Date().toISOString(),
          rootDir: snapshotResult.rootDir,
          screenshotPath: snapshotResult.screenshotPath,
          htmlPath: snapshotResult.htmlPath,
          state: {
            sessionId: session.sessionId,
            observedAt: new Date().toISOString(),
            ...snapshotResult.state
          }
        };
        sendJson(response, 200, { ok: true, snapshot });
        return;
      }

      if (request.method === 'POST' && request.url === '/v1/session/close') {
        const body = (await readJsonBody(request)) as { sessionId?: string };
        const session = body?.sessionId ? registry.get(body.sessionId) : undefined;
        if (!session) {
          throw new BrowserPlatformError('Session not found', { code: 'SESSION_NOT_FOUND' });
        }

        await controller.closeSession(session.sessionId);
        sendJson(response, 200, { ok: true, session: registry.close(session.sessionId) });
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
    await controller.closeAll();
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
