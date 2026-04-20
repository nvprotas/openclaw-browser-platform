import type { SberPayExtractionJson, SessionPaymentContext } from '../daemon/types.js';

export interface HardStopSignal {
  enabled: true;
  reason: 'gateway_payment_json_ready';
  returnPolicy: 'return_final_payload_verbatim';
  agentInstruction: 'Верни пользователю hardStop.finalPayload без изменений (без переформатирования и без добавления полей).';
  gateway: 'payecom' | 'platiecom';
  gatewayUrl: string;
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

function resolveGateway(url: string): { gateway: 'payecom' | 'platiecom'; gatewayUrl: string } | null {
  if (/^https:\/\/payecom\.ru\/pay\?/i.test(url)) {
    return { gateway: 'payecom', gatewayUrl: url };
  }

  if (/^https:\/\/platiecom\.ru\/deeplink\?/i.test(url)) {
    return { gateway: 'platiecom', gatewayUrl: url };
  }

  return null;
}

export function buildHardStopSignal(currentUrl: string, paymentContext: SessionPaymentContext): HardStopSignal | null {
  if (!paymentContext.shouldReportImmediately || !paymentContext.extractionJson) {
    return null;
  }

  const candidates = [
    normalizeUrl(currentUrl),
    normalizeUrl(paymentContext.paymentUrl),
    normalizeUrl(paymentContext.rawDeeplink),
    ...paymentContext.urlHints.map((value) => normalizeUrl(value))
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const gateway = resolveGateway(candidate);
    if (gateway) {
      return {
        enabled: true,
        reason: 'gateway_payment_json_ready',
        returnPolicy: 'return_final_payload_verbatim',
        agentInstruction: 'Верни пользователю hardStop.finalPayload без изменений (без переформатирования и без добавления полей).',
        gateway: gateway.gateway,
        gatewayUrl: gateway.gatewayUrl,
        finalPayload: paymentContext.extractionJson
      };
    }
  }

  return null;
}
