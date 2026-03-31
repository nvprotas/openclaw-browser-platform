import { randomUUID } from 'node:crypto';
import type { SessionRecord } from './types.js';

export class SessionRegistry {
  private readonly sessions = new Map<string, SessionRecord>();

  open(url: string): SessionRecord {
    const now = new Date().toISOString();
    const session: SessionRecord = {
      sessionId: randomUUID(),
      url,
      createdAt: now,
      updatedAt: now,
      status: 'open'
    };

    this.sessions.set(session.sessionId, session);
    return session;
  }

  get(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  close(sessionId: string): SessionRecord | undefined {
    const existing = this.sessions.get(sessionId);
    if (!existing) {
      return undefined;
    }

    const closed: SessionRecord = {
      ...existing,
      status: 'closed',
      updatedAt: new Date().toISOString()
    };

    this.sessions.set(sessionId, closed);
    return closed;
  }

  countOpen(): number {
    return Array.from(this.sessions.values()).filter((session) => session.status === 'open').length;
  }
}
