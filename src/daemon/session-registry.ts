import { randomUUID } from 'node:crypto';
import { createEmptyPaymentContext } from '../helpers/payment-context.js';
import type { SessionBackend, SessionRecord } from './types.js';

export class SessionRegistry {
  private readonly sessions = new Map<string, SessionRecord>();

  open(input: {
    url: string;
    title?: string | null;
    backend?: SessionBackend;
    scenarioId?: string | null;
    profileContext?: SessionRecord['profileContext'];
  }): SessionRecord {
    const now = new Date().toISOString();
    const session: SessionRecord = {
      sessionId: randomUUID(),
      backend: input.backend ?? 'chromium',
      url: input.url,
      title: input.title ?? null,
      createdAt: now,
      updatedAt: now,
      status: 'open',
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
        bootstrapError: null
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
    patch: Partial<Pick<SessionRecord, 'url' | 'title' | 'status' | 'scenarioContext' | 'profileContext' | 'packContext' | 'authContext' | 'paymentContext'>>
  ): SessionRecord | undefined {
    const existing = this.sessions.get(sessionId);
    if (!existing) {
      return undefined;
    }

    const updated: SessionRecord = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString()
    };

    this.sessions.set(sessionId, updated);
    return updated;
  }

  close(sessionId: string): SessionRecord | undefined {
    return this.touch(sessionId, { status: 'closed' });
  }

  countOpen(): number {
    return Array.from(this.sessions.values()).filter((session) => session.status === 'open').length;
  }
}
