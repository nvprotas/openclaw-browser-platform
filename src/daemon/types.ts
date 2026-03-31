export interface SessionRecord {
  sessionId: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  status: 'open' | 'closed';
}

export interface DaemonInfo {
  pid: number;
  port: number;
  token: string;
  startedAt: string;
  version: string;
}

export interface DaemonStatusResponse {
  ok: true;
  daemon: {
    pid: number;
    port: number;
    startedAt: string;
    uptimeMs: number;
    sessionCount: number;
    version: string;
  };
}

export interface SessionOpenResponse {
  ok: true;
  session: SessionRecord;
}

export interface SessionContextResponse {
  ok: true;
  session: SessionRecord;
}

export interface SessionCloseResponse {
  ok: true;
  session: SessionRecord;
}
