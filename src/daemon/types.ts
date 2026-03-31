export interface SessionRecord {
  sessionId: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  status: 'open' | 'closed';
  title: string | null;
}

export interface SessionObservation {
  sessionId: string;
  observedAt: string;
  url: string;
  title: string;
  readyState: string;
  viewport: {
    width: number;
    height: number;
  };
  visibleTexts: string[];
  visibleButtons: Array<{
    text: string;
    role: string;
    type: string | null;
    ariaLabel: string | null;
  }>;
  forms: Array<{
    id: string | null;
    name: string | null;
    method: string | null;
    action: string | null;
    inputCount: number;
    submitLabels: string[];
  }>;
  pageSignatureGuess: string;
}

export interface SessionSnapshot {
  sessionId: string;
  capturedAt: string;
  rootDir: string;
  screenshotPath: string;
  htmlPath: string;
  state: SessionObservation;
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

export interface SessionObserveResponse {
  ok: true;
  session: SessionObservation;
}

export interface SessionSnapshotResponse {
  ok: true;
  snapshot: SessionSnapshot;
}
