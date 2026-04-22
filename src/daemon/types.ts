export interface TimingEntry {
  step: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: 'ok' | 'error' | 'skipped';
  detail: string | null;
}

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
  bootstrapSource: 'explicit' | 'named' | 'auto_litres' | null;
  storageStatePath: string | null;
  storageStateExists: boolean;
  authenticatedSignals: string[];
  anonymousSignals: string[];
  handoffRequired: boolean;
  bootstrapFailed: boolean;
  redirectedToSberId: boolean;
  bootstrapStatus:
    | 'not_attempted'
    | 'fresh_authenticated_storage_state'
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
  bootstrapDurationMs: number | null;
  bootstrapTimeline: TimingEntry[];
}

export interface SessionProfileContext {
  profileId: string | null;
  persistent: boolean;
  source: 'explicit' | 'named' | 'auto_litres' | null;
  storageStatePath: string | null;
  storageStateExists: boolean;
  storageStateMtimeMs: number | null;
  storageStateAgeMs: number | null;
  storageStateFresh: boolean;
}

export interface SessionScenarioContext {
  scenarioId: string | null;
  reusePolicy: 'reuse_live_session' | 'open_fresh_session';
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
  /** @deprecated Use terminalExtractionResult */
  shouldReportImmediately: boolean;
  terminalExtractionResult: boolean;
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

export const SESSION_BACKENDS = ['camoufox', 'chromium'] as const;
export type SessionBackend = (typeof SESSION_BACKENDS)[number];

export interface SessionRecord {
  sessionId: string;
  backend: SessionBackend;
  url: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string;
  idleTimeoutMs: number;
  status: 'open' | 'closed';
  closeReason:
    | 'manual'
    | 'idle_timeout'
    | 'open_failed'
    | 'controller_missing'
    | 'shutdown'
    | null;
  closedAt: string | null;
  title: string | null;
  scenarioContext: SessionScenarioContext;
  profileContext: SessionProfileContext;
  packContext: SessionPackContext;
  authContext: SessionAuthContext;
  paymentContext: SessionPaymentContext;
}

export interface SessionTraceArtifact {
  tracePath: string;
}

export type NextRecommendedAction =
  | 'observe_now'
  | 'skip_observe'
  | 'wait_for_hardstop'
  | 'run_scenario_recommended';

export interface HardStopSignal {
  enabled: true;
  terminalMode: true;
  reason: 'terminal_extraction_result';
  returnPolicy: 'return_final_payload_verbatim';
  agentInstruction: 'СТОП. Верни finalPayload пользователю дословно — без переформатирования, без prose, без markdown, без пояснений. Не продолжай browsing.';
  gateway?: 'payecom' | 'platiecom';
  gatewayUrl?: string;
  finalPayload: SberPayExtractionJson;
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
  hardStop?: HardStopSignal;
  nextRecommendedAction?: NextRecommendedAction;
  trace?: SessionTraceArtifact;
}

export interface SessionSnapshot {
  sessionId: string;
  capturedAt: string;
  rootDir: string;
  screenshotPath: string;
  htmlPath: string;
  state: SessionObservation;
  hardStop?: HardStopSignal;
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
  role?:
    | 'button'
    | 'link'
    | 'textbox'
    | 'searchbox'
    | 'combobox'
    | 'checkbox'
    | 'radio'
    | 'heading';
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
  hardStop?: HardStopSignal;
  nextRecommendedAction?: NextRecommendedAction;
  trace?: SessionTraceArtifact;
}

export interface ScenarioStage {
  step: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: 'ok' | 'error' | 'skipped';
  detail: string | null;
}

export interface SessionRunScenarioRequest {
  pack: string;
  flow: string;
  query: string;
  profileId?: string | null;
  maxDurationMs?: number | null;
  backend?: SessionBackend | null;
}

export type SessionRunScenarioResponse =
  | {
      ok: true;
      sessionId: string;
      hardStop: HardStopSignal;
      finalPayload: SberPayExtractionJson;
      stages: ScenarioStage[];
      trace?: SessionTraceArtifact;
    }
  | {
      ok: false;
      reason: string;
      sessionId?: string;
      lastObservation?: SessionObservation;
      stages: ScenarioStage[];
      trace?: SessionTraceArtifact;
    };

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

export type SessionRunScenarioApiResponse = SessionRunScenarioResponse;
