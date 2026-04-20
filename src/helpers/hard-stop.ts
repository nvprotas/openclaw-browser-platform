import type {
  SberPayExtractionJson,
  SessionPaymentContext
} from '../daemon/types.js';

export interface HardStopSignal {
  enabled: true;
  reason: 'gateway_payment_json_ready';
  gateway: 'payecom' | 'platiecom' | 'yoomoney';
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

function resolveGateway(
  url: string
): {
  gateway: 'payecom' | 'platiecom' | 'yoomoney';
  gatewayUrl: string;
} | null {
  if (/^https:\/\/payecom\.ru\/pay\?/i.test(url)) {
    return { gateway: 'payecom', gatewayUrl: url };
  }

  if (/^https:\/\/platiecom\.ru\/deeplink\?/i.test(url)) {
    return { gateway: 'platiecom', gatewayUrl: url };
  }

  if (
    /^https:\/\/yoomoney\.ru\/checkout\/payments\/v2\/contract(?:\/sberpay)?\?/i.test(
      url
    )
  ) {
    return { gateway: 'yoomoney', gatewayUrl: url };
  }

  return null;
}

export function buildHardStopSignal(
  currentUrl: string,
  paymentContext: SessionPaymentContext
): HardStopSignal | null {
  if (
    !paymentContext.shouldReportImmediately ||
    !paymentContext.extractionJson
  ) {
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
        gateway: gateway.gateway,
        gatewayUrl: gateway.gatewayUrl,
        finalPayload: paymentContext.extractionJson
      };
    }
  }

  return null;
}
