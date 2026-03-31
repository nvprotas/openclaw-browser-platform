import type { FormSummary, VisibleButtonSummary } from '../playwright/dom-utils.js';
import type { PaymentIntentSummary, SberPayExtractionJson, SessionPaymentContext } from '../daemon/types.js';

interface PaymentContextInput {
  url: string;
  visibleTexts: string[];
  visibleButtons: VisibleButtonSummary[];
  forms: FormSummary[];
  urlHints: string[];
}

const PAYMENT_URL_PATTERN = /https?:\/\/(?:www\.)?(?:payecom\.ru\/pay(?:_ru)?|platiecom\.ru\/deeplink)[^\s"'<>)]*/gi;
const PAYMENT_PARAM_PATTERN = /(orderid|bankinvoiceid|merchantordernumber|merchantorderid|mdorder|formurl|href|order|trace-id|method|system)=([^\s&"'<>]+)/gi;

interface ExtractAccumulator {
  paymentUrls: string[];
  orderIds: string[];
  bankInvoiceIds: string[];
  merchantOrderNumbers: string[];
  merchantOrderIds: string[];
  mdOrders: string[];
  formUrls: string[];
  rawDeeplinks: string[];
  hrefs: string[];
  litresOrders: string[];
  traceIds: string[];
  paymentMethods: string[];
  paymentSystems: string[];
}

function uniq(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => (value ?? '').trim()).filter(Boolean)));
}

function first(values: string[]): string | null {
  return values[0] ?? null;
}

function deepDecode(text: string): string {
  let current = text;
  for (let i = 0; i < 3; i += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) {
        break;
      }
      current = decoded;
    } catch {
      break;
    }
  }
  return current;
}

function toAbsoluteUrl(candidate: string, baseUrl: string): string | null {
  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return null;
  }
}

function collectKnownParams(url: URL, acc: ExtractAccumulator): void {
  for (const [key, value] of url.searchParams.entries()) {
    const lowered = key.toLowerCase();

    if (lowered === 'orderid') {
      acc.orderIds.push(value);
    } else if (lowered === 'bankinvoiceid') {
      acc.bankInvoiceIds.push(value);
    } else if (lowered === 'merchantordernumber') {
      acc.merchantOrderNumbers.push(value);
    } else if (lowered === 'merchantorderid') {
      acc.merchantOrderIds.push(value);
    } else if (lowered === 'mdorder') {
      acc.mdOrders.push(value);
    } else if (lowered === 'formurl') {
      acc.formUrls.push(deepDecode(value));
    } else if (lowered === 'href') {
      acc.hrefs.push(deepDecode(value));
    } else if (lowered === 'order') {
      acc.litresOrders.push(value);
    } else if (lowered === 'trace-id') {
      acc.traceIds.push(value);
    } else if (lowered === 'method') {
      acc.paymentMethods.push(value);
    } else if (lowered === 'system') {
      acc.paymentSystems.push(value);
    }
  }
}


function collectParamPair(key: string, rawValue: string, acc: ExtractAccumulator): void {
  const lowered = key.toLowerCase();
  const value = deepDecode(rawValue).trim();

  if (!value) {
    return;
  }

  if (lowered === 'orderid') {
    acc.orderIds.push(value);
  } else if (lowered === 'bankinvoiceid') {
    acc.bankInvoiceIds.push(value);
  } else if (lowered === 'merchantordernumber') {
    acc.merchantOrderNumbers.push(value);
  } else if (lowered === 'merchantorderid') {
    acc.merchantOrderIds.push(value);
  } else if (lowered === 'mdorder') {
    acc.mdOrders.push(value);
  } else if (lowered === 'formurl') {
    acc.formUrls.push(value);
    collectCandidate(value, 'https://payecom.ru/', acc);
  } else if (lowered === 'href') {
    acc.hrefs.push(value);
    collectCandidate(value, 'https://payecom.ru/', acc);
  } else if (lowered === 'order') {
    acc.litresOrders.push(value);
  } else if (lowered === 'trace-id') {
    acc.traceIds.push(value);
  } else if (lowered === 'method') {
    acc.paymentMethods.push(value);
  } else if (lowered === 'system') {
    acc.paymentSystems.push(value);
  }
}

function collectLooseSignals(raw: string, baseUrl: string, acc: ExtractAccumulator): void {
  const variants = uniq([raw, deepDecode(raw)]);

  for (const variant of variants) {
    for (const match of variant.matchAll(PAYMENT_URL_PATTERN)) {
      collectCandidate(match[0], baseUrl, acc);
    }

    for (const [, key, value] of variant.matchAll(PAYMENT_PARAM_PATTERN)) {
      collectParamPair(key, value, acc);
    }

    if (/id\.sber\.ru\/.+authorize/i.test(variant)) {
      const hrefMatch = variant.match(/https?:\/\/id\.sber\.ru\/[^\s"'<>)]*/i);
      if (hrefMatch?.[0]) {
        acc.hrefs.push(deepDecode(hrefMatch[0]));
      }
    }
  }
}

function parseEncodedParams(raw: string, acc: ExtractAccumulator): void {
  const variants = uniq([raw, deepDecode(raw)]);

  for (const variant of variants) {
    try {
      const params = new URLSearchParams(variant.startsWith('?') ? variant.slice(1) : variant);
      for (const [key, value] of params.entries()) {
        collectParamPair(key, value, acc);
      }
    } catch {
      // ignore badly-formed params payloads
    }
  }
}

function collectCandidate(candidate: string, baseUrl: string, acc: ExtractAccumulator): void {
  const absolute = toAbsoluteUrl(candidate, baseUrl);
  if (!absolute) {
    return;
  }

  let url: URL;
  try {
    url = new URL(absolute);
  } catch {
    return;
  }

  const href = url.toString();
  collectKnownParams(url, acc);

  if (/payecom\.ru\/pay(?:_ru)?/i.test(href)) {
    acc.paymentUrls.push(href);
  }

  if (/platiecom\.ru\/deeplink/i.test(href)) {
    acc.rawDeeplinks.push(href);
    const params = url.searchParams.get('params');
    if (params) {
      parseEncodedParams(params, acc);
    }
  }

  if (/id\.sber\.ru\/.+authorize/i.test(href)) {
    acc.hrefs.push(href);
  }
}

function buildPaymentIntents(orderIds: string[]): PaymentIntentSummary[] {
  return uniq(orderIds).map((orderId) => ({ provider: 'sberpay', orderId }));
}

function pickExtractionSource(input: {
  paymentUrl: string | null;
  rawDeeplink: string | null;
  bankInvoiceId: string | null;
  merchantOrderNumber: string | null;
  merchantOrderId: string | null;
  mdOrder: string | null;
  formUrl: string | null;
}): 'url' | 'deeplink' | 'network_response' {
  if (input.rawDeeplink) {
    return 'deeplink';
  }

  if (input.bankInvoiceId || input.merchantOrderNumber || input.merchantOrderId || input.mdOrder || input.formUrl) {
    return 'network_response';
  }

  return 'url';
}

function buildExtractionJson(input: {
  provider: 'sberpay' | 'sbp' | null;
  paymentUrl: string | null;
  paymentOrderId: string | null;
  paymentIntents: PaymentIntentSummary[];
  bankInvoiceId: string | null;
  merchantOrderNumber: string | null;
  merchantOrderId: string | null;
  rawDeeplink: string | null;
  mdOrder: string | null;
  formUrl: string | null;
  href: string | null;
}): SberPayExtractionJson | null {
  if (input.provider !== 'sberpay') {
    return null;
  }

  return {
    paymentMethod: 'SberPay',
    paymentUrl: input.paymentUrl,
    paymentOrderId: input.paymentOrderId,
    paymentIntents: input.paymentIntents,
    bankInvoiceId: input.bankInvoiceId,
    merchantOrderNumber: input.merchantOrderNumber,
    merchantOrderId: input.merchantOrderId,
    rawDeeplink: input.rawDeeplink,
    source: pickExtractionSource(input),
    mdOrder: input.mdOrder,
    formUrl: input.formUrl,
    href: input.href
  };
}

export function createEmptyPaymentContext(): SessionPaymentContext {
  return {
    detected: false,
    shouldReportImmediately: false,
    provider: null,
    phase: null,
    paymentMethod: null,
    paymentSystem: null,
    paymentUrl: null,
    paymentOrderId: null,
    litresOrder: null,
    traceId: null,
    bankInvoiceId: null,
    merchantOrderNumber: null,
    merchantOrderId: null,
    mdOrder: null,
    formUrl: null,
    rawDeeplink: null,
    href: null,
    urlHints: [],
    paymentIntents: [],
    extractionJson: null
  };
}

export function extractPaymentContext(input: PaymentContextInput): SessionPaymentContext {
  const acc: ExtractAccumulator = {
    paymentUrls: [],
    orderIds: [],
    bankInvoiceIds: [],
    merchantOrderNumbers: [],
    merchantOrderIds: [],
    mdOrders: [],
    formUrls: [],
    rawDeeplinks: [],
    hrefs: [],
    litresOrders: [],
    traceIds: [],
    paymentMethods: [],
    paymentSystems: []
  };

  const formActionHints = input.forms
    .map((form) => form.action)
    .filter((value): value is string => Boolean(value))
    .map((value) => toAbsoluteUrl(value, input.url))
    .filter((value): value is string => Boolean(value));

  const urlHints = uniq(input.urlHints);
  const candidates = uniq([input.url, ...urlHints, ...formActionHints]);
  candidates.forEach((candidate) => collectCandidate(candidate, input.url, acc));

  const combinedTextRaw = `${input.visibleTexts.join(' ')} ${input.visibleButtons
    .map((button) => `${button.text} ${button.ariaLabel ?? ''}`.trim())
    .join(' ')} ${input.forms
    .flatMap((form) => [form.id ?? '', form.name ?? '', form.action ?? '', ...form.submitLabels])
    .join(' ')}`;
  collectLooseSignals(combinedTextRaw, input.url, acc);
  urlHints.forEach((hint) => collectLooseSignals(hint, input.url, acc));

  const combinedText = combinedTextRaw.toLowerCase();

  const paymentUrl = first(uniq([...acc.paymentUrls, ...acc.formUrls]));
  const paymentOrderId = first(uniq([...acc.orderIds, ...acc.mdOrders]));
  const litresOrder = first(uniq(acc.litresOrders));
  const traceId = first(uniq(acc.traceIds));
  const paymentMethod = first(uniq(acc.paymentMethods));
  const paymentSystem = first(uniq(acc.paymentSystems));
  const bankInvoiceId = first(uniq(acc.bankInvoiceIds));
  const merchantOrderNumber = first(uniq(acc.merchantOrderNumbers));
  const merchantOrderId = first(uniq(acc.merchantOrderIds));
  const mdOrder = first(uniq(acc.mdOrders));
  const formUrl = first(uniq(acc.formUrls));
  const rawDeeplink = first(uniq(acc.rawDeeplinks));
  const href = first(uniq(acc.hrefs));
  const paymentIntents = buildPaymentIntents([...acc.orderIds, ...acc.mdOrders]);

  const sberIdHandoffVisible = Boolean(href) || urlHints.some((hint) => /id\.sber\.ru\/.+authorize/i.test(hint));

  let phase: SessionPaymentContext['phase'] = null;
  if (/platiecom\.ru\/deeplink/i.test(input.url) || rawDeeplink) {
    phase = 'platiecom_deeplink';
  } else if (/payecom\.ru\/pay(?:_ru)?/i.test(input.url)) {
    phase = 'payecom_boundary';
  } else if (/\/purchase\/ppd\b/i.test(input.url) || paymentUrl || rawDeeplink || sberIdHandoffVisible) {
    phase = 'litres_checkout';
  }

  let provider: SessionPaymentContext['provider'] = null;
  if (
    /войти по сбер id|sberpay|сбер id|сберпей/.test(combinedText) ||
    Boolean(paymentUrl) ||
    Boolean(rawDeeplink) ||
    (href ? /id\.sber\.ru\/.+authorize/i.test(href) : false)
  ) {
    provider = 'sberpay';
  } else if (paymentMethod === 'sbp' || paymentSystem === 'sbersbp') {
    provider = 'sbp';
  }

  const detected = Boolean(
    phase ||
      paymentUrl ||
      paymentOrderId ||
      litresOrder ||
      traceId ||
      bankInvoiceId ||
      merchantOrderNumber ||
      merchantOrderId ||
      mdOrder ||
      formUrl ||
      rawDeeplink ||
      href
  );

  const extractionJson = buildExtractionJson({
    provider,
    paymentUrl,
    paymentOrderId,
    paymentIntents,
    bankInvoiceId,
    merchantOrderNumber,
    merchantOrderId,
    rawDeeplink,
    mdOrder,
    formUrl,
    href
  });

  const shouldReportImmediately = Boolean(
    extractionJson &&
      (extractionJson.paymentOrderId ||
        extractionJson.paymentUrl ||
        extractionJson.bankInvoiceId ||
        extractionJson.merchantOrderNumber ||
        extractionJson.merchantOrderId ||
        extractionJson.mdOrder ||
        extractionJson.formUrl ||
        extractionJson.rawDeeplink ||
        extractionJson.href)
  );

  return {
    detected,
    shouldReportImmediately,
    provider,
    phase,
    paymentMethod,
    paymentSystem,
    paymentUrl,
    paymentOrderId,
    litresOrder,
    traceId,
    bankInvoiceId,
    merchantOrderNumber,
    merchantOrderId,
    mdOrder,
    formUrl,
    rawDeeplink,
    href,
    urlHints,
    paymentIntents,
    extractionJson
  };
}
