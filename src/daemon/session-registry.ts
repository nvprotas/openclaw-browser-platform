import { randomUUID } from 'node:crypto';
import { createEmptyPaymentContext } from '../helpers/payment-context.js';
import type { SessionHandoff, HandoffReason, SessionRecord } from './types.js';

function createDefaultHandoff(): SessionHandoff {
  return {
    active: false,
    mode: 'vnc',
    connect: {
      host: '127.0.0.1',
      port: null,
      url: null,
      novncUrl: null
    },
    reason: null,
    startedAt: null,
    resumedAt: null,
    stoppedAt: null
  };
}

export class SessionRegistry {
  private readonly sessions = new Map<string, SessionRecord>();

  open(input: { url: string; title?: string | null }): SessionRecord {
    const now = new Date().toISOString();
    const session: SessionRecord = {
      sessionId: randomUUID(),
      url: input.url,
      title: input.title ?? null,
      createdAt: now,
      updatedAt: now,
      status: 'open',
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
      paymentContext: createEmptyPaymentContext(),
      handoff: createDefaultHandoff()
    };

    this.sessions.set(session.sessionId, session);
    return session;
  }

  get(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  touch(
    sessionId: string,
    patch: Partial<Pick<SessionRecord, 'url' | 'title' | 'status' | 'packContext' | 'authContext' | 'paymentContext' | 'handoff'>>
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
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    return this.touch(sessionId, {
      status: 'closed',
      handoff: session.handoff.active
        ? {
            ...session.handoff,
            active: false,
            stoppedAt: new Date().toISOString()
          }
        : session.handoff
    });
  }

  countOpen(): number {
    return Array.from(this.sessions.values()).filter((session) => session.status === 'open').length;
  }

  startHandoff(sessionId: string, reason: HandoffReason | null): SessionRecord | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    const now = new Date().toISOString();
    const handoff = session.handoff.active
      ? {
          ...session.handoff,
          reason: reason ?? session.handoff.reason ?? 'unknown_ui_state'
        }
      : {
          ...createDefaultHandoff(),
          active: true,
          reason: reason ?? 'unknown_ui_state',
          startedAt: now,
          resumedAt: null,
          stoppedAt: null
        };

    return this.touch(sessionId, { handoff });
  }

  resumeHandoff(sessionId: string): SessionRecord | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    return this.touch(sessionId, {
      handoff: {
        ...session.handoff,
        active: false,
        resumedAt: new Date().toISOString(),
        connect: {
          host: '127.0.0.1',
          port: null,
          url: null,
          novncUrl: null
        }
      }
    });
  }

  stopHandoff(sessionId: string): SessionRecord | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    return this.touch(sessionId, {
      handoff: {
        ...createDefaultHandoff(),
        reason: null,
        startedAt: session.handoff.startedAt,
        resumedAt: session.handoff.resumedAt,
        stoppedAt: new Date().toISOString()
      }
    });
  }
}
