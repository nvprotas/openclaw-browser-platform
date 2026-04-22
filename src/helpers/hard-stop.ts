import type { SberPayExtractionJson, SessionPaymentContext } from '../daemon/types.js';

export interface HardStopSignal {
  enabled: true;
  terminalMode: true;
  reason: 'terminal_extraction_result';
  returnPolicy: 'return_final_payload_verbatim';
  agentInstruction: 'СТОП. Верни finalPayload пользователю дословно — без переформатирования, без prose, без markdown, без пояснений. Не продолжай browsing.';
  gateway?: 'payecom' | 'platiecom' | 'yoomoney';
  gatewayUrl?: string;
  finalPayload: SberPayExtractionJson;
}

function normalizeUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

function resolveGateway(url: string): { gateway: 'payecom' | 'platiecom' | 'yoomoney'; gatewayUrl: string } | null {
  if (/^https:\/\/payecom\.ru\/pay\?/i.test(url)) {
    return { gateway: 'payecom', gatewayUrl: url };
  }

  if (/^https:\/\/platiecom\.ru\/deeplink\?/i.test(url)) {
    return { gateway: 'platiecom', gatewayUrl: url };
  }

  if (/^https:\/\/yoomoney\.ru\/checkout\/payments\/v2\/contract/i.test(url)) {
    return { gateway: 'yoomoney', gatewayUrl: url };
  }

  return null;
}

export function buildHardStopSignal(currentUrl: string, paymentContext: SessionPaymentContext): HardStopSignal | null {
  const isTerminal = paymentContext.terminalExtractionResult || paymentContext.shouldReportImmediately;
  if (!isTerminal || !paymentContext.extractionJson) {
    return null;
  }

  const candidates = [
    normalizeUrl(currentUrl),
    normalizeUrl(paymentContext.paymentUrl),
    normalizeUrl(paymentContext.rawDeeplink),
    ...paymentContext.urlHints.map((value) => normalizeUrl(value))
  ].filter((value): value is string => Boolean(value));

  let gateway: { gateway: 'payecom' | 'platiecom' | 'yoomoney'; gatewayUrl: string } | undefined;
  for (const candidate of candidates) {
    const resolved = resolveGateway(candidate);
    if (resolved) {
      gateway = resolved;
      break;
    }
  }

  return {
    enabled: true,
    terminalMode: true,
    reason: 'terminal_extraction_result',
    returnPolicy: 'return_final_payload_verbatim',
    agentInstruction: 'СТОП. Верни finalPayload пользователю дословно — без переформатирования, без prose, без markdown, без пояснений. Не продолжай browsing.',
    ...(gateway ? { gateway: gateway.gateway, gatewayUrl: gateway.gatewayUrl } : {}),
    finalPayload: paymentContext.extractionJson
  };
}
