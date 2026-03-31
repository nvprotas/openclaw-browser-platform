export interface SessionPackContext {
  matchedPack: boolean;
  siteId: string | null;
  supportLevel: 'generic' | 'profiled' | 'assisted' | 'hardened' | null;
  matchedDomain: string | null;
  startUrl: string | null;
  flows: string[];
  knownRisks: string[];
  instructionsSummary: string[];
  knownSignals: string[];
}

export interface SessionRecord {
  sessionId: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  status: 'open' | 'closed';
  title: string | null;
  packContext: SessionPackContext;
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

export interface ActionObservationSummary {
  level: 'info' | 'warning';
  code: string;
  message: string;
}

export interface ActionDiffSummary {
  urlChanged: boolean;
  titleChanged: boolean;
  pageSignatureChanged: boolean;
  addedButtons: string[];
  removedButtons: string[];
  addedTexts: string[];
  removedTexts: string[];
}

interface ActionTarget {
  selector?: string;
  text?: string;
  exact?: boolean;
  role?: 'button' | 'link' | 'textbox' | 'searchbox' | 'combobox' | 'checkbox' | 'radio' | 'heading';
  name?: string;
  timeoutMs?: number;
}

export interface NavigateActionPayload {
  action: 'navigate';
  url: string;
  timeoutMs?: number;
}

export interface ClickActionPayload extends ActionTarget {
  action: 'click';
}

export interface FillActionPayload extends ActionTarget {
  action: 'fill';
  value: string;
}

export interface TypeActionPayload extends ActionTarget {
  action: 'type';
  value: string;
  delayMs?: number;
  clearFirst?: boolean;
}

export interface PressActionPayload extends ActionTarget {
  action: 'press';
  key: string;
  delayMs?: number;
}

export interface WaitForActionPayload extends ActionTarget {
  action: 'wait_for';
  state?: 'attached' | 'detached' | 'visible' | 'hidden';
}

export type SessionActionPayload =
  | NavigateActionPayload
  | ClickActionPayload
  | FillActionPayload
  | TypeActionPayload
  | PressActionPayload
  | WaitForActionPayload;

export interface SessionActionResult {
  sessionId: string;
  actedAt: string;
  action: SessionActionPayload['action'];
  target: {
    selector: string | null;
    role: string | null;
    name: string | null;
    text: string | null;
  };
  input: {
    value: string | null;
    url: string | null;
    key: string | null;
  };
  before: SessionObservation;
  after: SessionObservation;
  changes: ActionDiffSummary;
  observations: ActionObservationSummary[];
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

export interface SessionActResponse {
  ok: true;
  action: SessionActionResult;
}
