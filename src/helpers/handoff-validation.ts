import type { SessionObservation } from '../daemon/types.js';
import type { AuthStateSummary } from '../playwright/auth-state.js';
import type {
  SessionHandoffPostResume,
  SessionHandoffPostResumeCheck
} from '../daemon/types.js';

function buildCheck(code: SessionHandoffPostResumeCheck['code'], ok: boolean, message: string): SessionHandoffPostResumeCheck {
  return {
    code,
    ok,
    message
  };
}

export function buildPostHandoffResumeValidation(
  observation: SessionObservation,
  authState: AuthStateSummary
): SessionHandoffPostResume {
  const paymentBoundaryVisible =
    observation.paymentContext.phase === 'litres_checkout' || observation.paymentContext.phase === 'payecom_boundary';
  const shouldReportPaymentJson = observation.paymentContext.shouldReportImmediately;
  const authRestored = authState.state === 'authenticated';
  const loginGateStillVisible = authState.loginGateDetected;
  const paymentJsonReportRequired = shouldReportPaymentJson;

  const checks = [
    buildCheck(
      'AUTH_RESTORED',
      authRestored,
      authRestored ? 'Authorization is restored after resume.' : `Authorization is not restored after resume: ${authState.state}.`
    ),
    buildCheck(
      'LOGIN_GATE_STILL_VISIBLE',
      !loginGateStillVisible,
      loginGateStillVisible ? 'Login gate is still visible after resume.' : 'Login gate is not visible after resume.'
    ),
    buildCheck(
      'PAYMENT_BOUNDARY_STILL_ACTIVE',
      !paymentBoundaryVisible,
      paymentBoundaryVisible
        ? `Payment boundary is still active after resume: ${observation.paymentContext.phase ?? 'unknown'}.`
        : 'Payment boundary is not active after resume.'
    ),
    buildCheck(
      'PAYMENT_JSON_REPORT_REQUIRED',
      !paymentJsonReportRequired,
      paymentJsonReportRequired
        ? 'Payment JSON should be reported before proceeding.'
        : 'No payment JSON report is required after resume.'
    )
  ];

  return {
    observedAt: observation.observedAt,
    url: observation.url,
    title: observation.title,
    pageSignatureGuess: observation.pageSignatureGuess,
    authState: authState.state,
    loginGateDetected: authState.loginGateDetected,
    paymentBoundaryVisible,
    shouldReportPaymentJson,
    checks,
    safeToProceed: checks.every((check) => check.ok)
  };
}
