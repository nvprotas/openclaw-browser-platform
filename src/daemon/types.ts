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

export interface SessionAuthContext {
  state: 'authenticated' | 'anonymous' | 'login_gate_detected';
  loginGateDetected: boolean;
  bootstrapAttempted: boolean;
  bootstrapSource: 'explicit' | 'auto_litres' | null;
  storageStatePath: string | null;
  storageStateExists: boolean;
  authenticatedSignals: string[];
  anonymousSignals: string[];
  handoffRequired: boolean;
  bootstrapFailed: boolean;
  redirectedToSberId: boolean;
  bootstrapStatus:
    | 'not_attempted'
    | 'reused_existing_state'
    | 'not_applicable'
    | 'skipped_missing_cookies'
    | 'redirected_to_sberid'
    | 'handoff_required'
    | 'state_refreshed'
    | 'completed_without_auth'
    | 'failed';
  bootstrapScriptPath: string | null;
  bootstrapOutDir: string | null;
  bootstrapFinalUrl: string | null;
  bootstrapError: string | null;
}

export interface PaymentIntentSummary {
  provider: 'sberpay';
  orderId: string;
}

export interface SberPayExtractionJson {
  paymentMethod: 'SberPay';
  paymentUrl: string | null;
  paymentOrderId: string | null;
  paymentIntents: PaymentIntentSummary[];
  bankInvoiceId: string | null;
  merchantOrderNumber: string | null;
  merchantOrderId: string | null;
  rawDeeplink: string | null;
  source: 'url' | 'deeplink' | 'network_response';
  mdOrder: string | null;
  formUrl: string | null;
  href: string | null;
}

export interface SessionPaymentContext {
  detected: boolean;
  shouldReportImmediately: boolean;
  provider: 'sberpay' | 'sbp' | null;
  phase: 'litres_checkout' | 'payecom_boundary' | 'platiecom_deeplink' | null;
  paymentMethod: string | null;
  paymentSystem: string | null;
  paymentUrl: string | null;
  paymentOrderId: string | null;
  litresOrder: string | null;
  traceId: string | null;
  bankInvoiceId: string | null;
  merchantOrderNumber: string | null;
  merchantOrderId: string | null;
  mdOrder: string | null;
  formUrl: string | null;
  rawDeeplink: string | null;
  href: string | null;
  urlHints: string[];
  paymentIntents: PaymentIntentSummary[];
  extractionJson: SberPayExtractionJson | null;
}

export type HandoffMode = 'vnc';

export type HandoffReason = 'auth_boundary' | 'payment_boundary' | 'manual_debug' | 'unknown_ui_state';

export interface SessionHandoffConnect {
  host: string;
  port: number | null;
  url: string | null;
  novncUrl: string | null;
}

export type SessionHandoffPostResumeCheckCode =
  | 'AUTH_RESTORED'
  | 'LOGIN_GATE_STILL_VISIBLE'
  | 'PAYMENT_BOUNDARY_STILL_ACTIVE'
  | 'PAYMENT_JSON_REPORT_REQUIRED';

export interface SessionHandoffPostResumeCheck {
  code: SessionHandoffPostResumeCheckCode;
  ok: boolean;
  message: string;
}

export interface SessionHandoffPostResume {
  observedAt: string;
  url: string;
  title: string;
  pageSignatureGuess: string;
  authState: SessionAuthContext['state'];
  loginGateDetected: boolean;
  paymentBoundaryVisible: boolean;
  shouldReportPaymentJson: boolean;
  checks: SessionHandoffPostResumeCheck[];
  safeToProceed: boolean;
}

export interface SessionHandoff {
  active: boolean;
  mode: HandoffMode;
  connect: SessionHandoffConnect;
  reason: HandoffReason | null;
  startedAt: string | null;
  resumedAt: string | null;
  stoppedAt: string | null;
}

export interface SessionRecord {
  sessionId: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  status: 'open' | 'closed';
  title: string | null;
  packContext: SessionPackContext;
  authContext: SessionAuthContext;
  paymentContext: SessionPaymentContext;
  handoff: SessionHandoff;
}

export interface SessionTraceArtifact {
  tracePath: string;
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
  urlHints: string[];
  pageSignatureGuess: string;
  paymentContext: SessionPaymentContext;
  trace?: SessionTraceArtifact;
}

export interface SessionSnapshot {
  sessionId: string;
  capturedAt: string;
  rootDir: string;
  screenshotPath: string;
  htmlPath: string;
  state: SessionObservation;
  trace?: SessionTraceArtifact;
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
  trace?: SessionTraceArtifact;
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

export interface SessionHandoffResponse {
  ok: true;
  sessionId: string;
  handoff: SessionHandoff;
  postResume?: SessionHandoffPostResume | null;
}
