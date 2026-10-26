import { createHmac, timingSafeEqual } from 'node:crypto';

const apiRoot = 'https://api.plisio.net/api/v1';

export function verifyPlisioCallback(payload, apiKey) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || typeof payload.verify_hash !== 'string' || !apiKey) return false;
  const { verify_hash: supplied, ...fields } = payload;
  const canonical = JSON.stringify(Object.fromEntries(
    Object.keys(fields).sort().map((key) => [key, fields[key]]),
  ));
  const expected = createHmac('sha1', apiKey).update(canonical).digest();
  let received;
  try {
    received = Buffer.from(supplied, 'hex');
  } catch {
    return false;
  }
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function normalizePlisioStatus(value) {
  switch (String(value || '').toLowerCase()) {
    case 'completed':
    case 'confirmed':
    case 'competed':
      return 'confirmed';
    case 'expired':
      return 'expired';
    case 'error':
    case 'cancelled':
      return 'failed';
    case 'mismatch':
      return 'mismatch';
    case 'new':
    case 'pending':
    case 'pending internal':
    case 'pending_external':
    case 'confirming':
      return 'pending';
    default:
      return 'unknown';
  }
}

export async function plisioRequest(path, parameters = {}, apiKey = process.env.PLISIO_API_KEY) {
  if (!apiKey) throw new Error('Plisio is not configured.');
  const url = new URL(`${apiRoot}${path}`);
  url.searchParams.set('api_key', apiKey);
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new Error('Plisio could not be reached. Check the provider status before retrying.');
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || result.status !== 'success' || !result.data) {
    const error = new Error('Plisio rejected the request or returned an invalid response.');
    error.providerStatus = response.status;
    throw error;
  }
  return result.data;
}

export async function quotePlisioWithdrawal(amountUsd, destination) {
  const estimate = await plisioRequest('/exchanges/estimate', {
    from_currency: 'USD',
    to_currency: 'USDT_TRX',
    from_amount: amountUsd,
    amount_currency: 'from_currency',
  });
  const quote = normalizePlisioQuote(estimate, amountUsd);
  const commission = await plisioRequest('/operations/commission/USDT_TRX', {
    addresses: destination,
    amounts: quote.providerAmount,
    type: 'cash_out',
    feePlan: 'normal',
  });
  const fee = decimalField(commission.fee);
  if (!fee) throw new Error('Plisio did not return a valid TRC20 network fee estimate.');
  return { ...quote, providerFee: fee, feeCurrency: stringField(commission.feeUnit) || 'USDT' };
}

export function normalizePlisioQuote(data, expectedUsd) {
  const fromCurrency = stringField(data?.from_currency);
  const toCurrency = stringField(data?.to_currency);
  const fromAmount = decimalField(data?.from_amount);
  const providerAmount = decimalField(data?.to_amount);
  if (fromCurrency !== 'USD' || toCurrency !== 'USDT_TRX'
    || fromAmount !== decimalField(expectedUsd) || !providerAmount || Number(providerAmount) <= 0) {
    throw new Error('Plisio returned a withdrawal quote that does not match the requested USD amount and USDT TRC20 network.');
  }
  return { fromCurrency, toCurrency, fromAmount, providerAmount };
}

export function normalizePlisioOperation(data) {
  if (!data || typeof data !== 'object') throw new Error('Plisio operation response is invalid.');
  const id = stringField(data.id ?? data.txn_id);
  const status = normalizePlisioStatus(data.status);
  if (!id || status === 'unknown') throw new Error('Plisio operation response is missing its ID or has an unknown status.');
  return {
    id,
    status,
    providerStatus: stringField(data.status),
    amount: decimalField(data.amount),
    currency: stringField(data.currency ?? data.psys_cid),
    destination: stringField(data.wallet_hash),
    transactionIds: Array.isArray(data.tx_id) ? data.tx_id.filter((item) => typeof item === 'string').slice(0, 10) : [],
    transactionUrl: stringField(data.tx_url),
  };
}

export function normalizePlisioInvoice(data, { allowMissingStatus = false } = {}) {
  if (!data || typeof data !== 'object') throw new Error('Plisio invoice response is invalid.');
  const id = stringField(data.id ?? data.txn_id);
  const missingStatus = data.status === undefined || data.status === null || data.status === '';
  const status = missingStatus && allowMissingStatus ? 'pending' : normalizePlisioStatus(data.status);
  const amountUsd = numericField(data.invoice_total_usd, data.source_amount, data.amount_usd);
  const orderNumber = stringField(data.order_number);
  const currency = stringField(data.currency);
  if (!id || status === 'unknown') throw new Error('Plisio invoice response is missing its ID or has an unknown status.');
  return {
    id,
    status,
    amountUsd,
    orderNumber,
    currency,
    invoiceUrl: stringField(data.invoice_url),
    walletHash: stringField(data.wallet_hash),
    expireAt: stringField(data.expire_utc),
    providerStatus: stringField(data.status) || (missingStatus ? 'pending' : ''),
  };
}

function stringField(value) {
  return typeof value === 'string' && value.length <= 2048 ? value : '';
}

function numericField(...values) {
  const candidate = values.find((value) => value !== null && value !== undefined);
  if (candidate === undefined) return null;
  const text = String(candidate);
  return /^\d{1,18}(?:\.\d{1,8})?$/.test(text) ? text : null;
}

function decimalField(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /^\d{1,18}(?:\.\d{1,12})?$/.test(text) ? text : '';
}
