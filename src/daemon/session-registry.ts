import { randomUUID } from 'node:crypto';
import { createEmptyPaymentContext } from '../helpers/payment-context.js';
import type { SessionBackend, SessionRecord } from './types.js';

export const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 30 * 60_000;

export class SessionRegistry {
  constructor(
    private readonly options: {
      defaultIdleTimeoutMs?: number;
      now?: () => number;
    } = {}
  ) {}

  private readonly sessions = new Map<string, SessionRecord>();

  private nowMs(): number {
    return this.options.now?.() ?? Date.now();
  }

  private nowIso(): string {
    return new Date(this.nowMs()).toISOString();
  }

  open(input: {
    url: string;
    title?: string | null;
    backend: SessionBackend;
    scenarioId?: string | null;
    profileContext?: SessionRecord['profileContext'];
    idleTimeoutMs?: number;
  }): SessionRecord {
    const now = this.nowIso();
    const session: SessionRecord = {
      sessionId: randomUUID(),
      backend: input.backend,
      url: input.url,
      title: input.title ?? null,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now,
      idleTimeoutMs: input.idleTimeoutMs ?? this.options.defaultIdleTimeoutMs ?? DEFAULT_SESSION_IDLE_TIMEOUT_MS,
      status: 'open',
      closeReason: null,
      closedAt: null,
      scenarioContext: {
        scenarioId: input.scenarioId ?? null,
        reusePolicy: 'open_fresh_session'
      },
      profileContext: input.profileContext ?? {
        profileId: null,
        persistent: false,
        source: null,
        storageStatePath: null,
        storageStateExists: false
      },
      packContext: {
        matchedPack: false,
        siteId: null,
        supportLevel: null,
        matchedDomain: null,
        startUrl: null,
        flows: [],
        knownRisks: [],
        instructionsSummary: [],
        knownSignals: []
      },
      authContext: {
        state: 'anonymous',
        loginGateDetected: false,
        bootstrapAttempted: false,
        bootstrapSource: null,
        storageStatePath: null,
        storageStateExists: false,
        authenticatedSignals: [],
        anonymousSignals: [],
        handoffRequired: false,
        bootstrapFailed: false,
        redirectedToSberId: false,
        bootstrapStatus: 'not_attempted',
        bootstrapScriptPath: null,
        bootstrapOutDir: null,
        bootstrapFinalUrl: null,
        bootstrapError: null,
        bootstrapDurationMs: null,
        bootstrapTimeline: []
      },
      paymentContext: createEmptyPaymentContext()
    };

    this.sessions.set(session.sessionId, session);
    return session;
  }

  get(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  touch(
    sessionId: string,
    patch: Partial<
      Pick<
        SessionRecord,
        | 'url'
        | 'title'
        | 'status'
        | 'scenarioContext'
        | 'profileContext'
        | 'packContext'
        | 'authContext'
        | 'paymentContext'
        | 'idleTimeoutMs'
        | 'closeReason'
        | 'closedAt'
      >
    >
  ): SessionRecord | undefined {
    const existing = this.sessions.get(sessionId);
    if (!existing) {
      return undefined;
    }

    const updated: SessionRecord = {
      ...existing,
      ...patch,
      updatedAt: this.nowIso()
    };

    this.sessions.set(sessionId, updated);
    return updated;
  }

  touchUsage(
    sessionId: string,
    patch: Partial<
      Pick<SessionRecord, 'url' | 'title' | 'scenarioContext' | 'profileContext' | 'packContext' | 'authContext' | 'paymentContext'>
    > = {}
  ): SessionRecord | undefined {
    const existing = this.sessions.get(sessionId);
    if (!existing) {
      return undefined;
    }

    const now = this.nowIso();
    const updated: SessionRecord = {
      ...existing,
      ...patch,
      updatedAt: now,
      lastUsedAt: now
    };

    this.sessions.set(sessionId, updated);
    return updated;
  }

  close(
    sessionId: string,
    reason: SessionRecord['closeReason'] = 'manual'
  ): SessionRecord | undefined {
    return this.touch(sessionId, {
      status: 'closed',
      closeReason: reason,
      closedAt: this.nowIso()
    });
  }

  remove(sessionId: string): SessionRecord | undefined {
    const existing = this.sessions.get(sessionId);
    if (!existing) {
      return undefined;
    }

    this.sessions.delete(sessionId);
    return existing;
  }

  findExpiredSessionIds(nowMs = this.nowMs()): string[] {
    return [...this.sessions.values()]
      .filter((session) => {
        if (session.status !== 'open') {
          return false;
        }

        const lastUsedMs = Date.parse(session.lastUsedAt);
        return Number.isFinite(lastUsedMs) && nowMs - lastUsedMs >= session.idleTimeoutMs;
      })
      .map((session) => session.sessionId);
  }

  closeAll(reason: SessionRecord['closeReason'] = 'shutdown'): SessionRecord[] {
    return [...this.sessions.keys()]
      .map((sessionId) => this.close(sessionId, reason))
      .filter((session): session is SessionRecord => Boolean(session));
  }

  clear(): void {
    this.sessions.clear();
  }

  countOpen(): number {
    return Array.from(this.sessions.values()).filter((session) => session.status === 'open').length;
  }
}
