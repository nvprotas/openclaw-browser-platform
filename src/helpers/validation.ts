import type { ActionObservationSummary, SessionPaymentContext } from '../daemon/types.js';
import type { PageStateSummary } from '../playwright/browser-session.js';
import { buildActionDiff, summarizeObservation } from './tracing.js';
import { buildHardStopSignal } from './hard-stop.js';

function paymentFingerprint(context: SessionPaymentContext): string {
  return JSON.stringify({
    phase: context.phase,
    paymentOrderId: context.paymentOrderId,
    litresOrder: context.litresOrder,
    traceId: context.traceId,
    bankInvoiceId: context.bankInvoiceId,
    merchantOrderNumber: context.merchantOrderNumber,
    merchantOrderId: context.merchantOrderId,
    mdOrder: context.mdOrder,
    formUrl: context.formUrl,
    rawDeeplink: context.rawDeeplink,
    href: context.href
  });
}

function summarizePaymentContext(context: SessionPaymentContext): string {
  if (context.extractionJson) {
    return JSON.stringify(context.extractionJson);
  }

  const parts = [
    context.paymentOrderId ? `paymentOrderId=${context.paymentOrderId}` : null,
    context.litresOrder ? `litresOrder=${context.litresOrder}` : null,
    context.traceId ? `traceId=${context.traceId}` : null,
    context.bankInvoiceId ? `bankInvoiceId=${context.bankInvoiceId}` : null,
    context.mdOrder ? `mdOrder=${context.mdOrder}` : null,
    context.formUrl ? `formUrl=${context.formUrl}` : null,
    context.merchantOrderId ? `merchantOrderId=${context.merchantOrderId}` : null,
    context.merchantOrderNumber ? `merchantOrderNumber=${context.merchantOrderNumber}` : null
  ].filter((value): value is string => Boolean(value));

  return parts.join(', ');
}

export function buildPostActionObservations(before: PageStateSummary, after: PageStateSummary): ActionObservationSummary[] {
  const observations = summarizeObservation(after);
  const diff = buildActionDiff(before, after);

  if (diff.urlChanged) {
    observations.push({ level: 'info', code: 'URL_CHANGED', message: `URL changed to ${after.url}` });
  }

  if (diff.titleChanged) {
    observations.push({ level: 'info', code: 'TITLE_CHANGED', message: `Title changed to ${after.title}` });
  }

  const isTerminal = after.paymentContext.terminalExtractionResult || after.paymentContext.shouldReportImmediately;
  const hardStop = buildHardStopSignal(after.url, after.paymentContext);

  if (isTerminal && paymentFingerprint(before.paymentContext) !== paymentFingerprint(after.paymentContext)) {
    observations.push({
      level: 'warning',
      code: 'PAYMENT_IDS_DETECTED',
      message: `СТОП: обнаружены payment identifiers. Верни extractionJson дословно без prose: ${summarizePaymentContext(after.paymentContext)}`
    });
  }

  if (hardStop) {
    const gatewayInfo = hardStop.gateway ? ` (${hardStop.gateway})` : '';
    observations.push({
      level: 'warning',
      code: 'HARD_STOP_TERMINAL_EXTRACTION_RESULT',
      message: `TERMINAL HARD STOP${gatewayInfo}: return hardStop.finalPayload JSON verbatim and do not continue normal flow.`
    });
  }

  if (!diff.urlChanged && !diff.titleChanged && !diff.pageSignatureChanged && diff.addedButtons.length === 0 && diff.addedTexts.length === 0) {
    const paymentFlowStillActive =
      after.paymentContext.phase === 'litres_checkout' ||
      after.paymentContext.phase === 'payecom_boundary' ||
      after.visibleTexts.some((text) => /войти по сбер id/i.test(text));

    observations.push({
      level: paymentFlowStillActive ? 'info' : 'warning',
      code: paymentFlowStillActive ? 'PAYMENT_FLOW_STILL_ACTIVE' : 'NO_OBVIOUS_CHANGE',
      message: paymentFlowStillActive
        ? 'The payment flow is still active, but the page did not produce a clear navigation-level change yet.'
        : 'No obvious page change was detected after the action.'
    });
  }

  return observations;
}
