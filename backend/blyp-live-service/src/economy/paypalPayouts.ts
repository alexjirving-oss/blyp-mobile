/**
 * PayPal Payouts helper for creator GEM cash-out.
 * Uses Client Credentials → POST /v1/payments/payouts (receiver = PayPal email).
 * Does not require Stripe Connect.
 */

import { getEconomyEnv } from '../config/economyEnv';
import { logger } from '../config/logger';
import { EconomyError } from './economyErrors';

function paypalMode(): 'live' | 'sandbox' {
  const raw = String((process.env.PAYPAL_MODE || 'live')).trim().toLowerCase();
  return raw === 'sandbox' || raw === 'test' ? 'sandbox' : 'live';
}

function paypalApiBase(): string {
  return paypalMode() === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';
}

export function paypalConfigured(): boolean {
  const id = String(process.env.PAYPAL_CLIENT_ID || '').trim();
  const secret = String(process.env.PAYPAL_CLIENT_SECRET || '').trim();
  return Boolean(id && secret);
}

export function getPayPalReadiness(): {
  configured: boolean;
  mode: 'live' | 'sandbox' | 'absent';
  note: string;
} {
  if (!paypalConfigured()) {
    return {
      configured: false,
      mode: 'absent',
      note: 'PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET missing — PayPal withdraw falls back to admin manual send',
    };
  }
  const mode = paypalMode();
  return {
    configured: true,
    mode,
    note: `PayPal Payouts credentials present (${mode})`,
  };
}

function normalizePaypalEmail(raw: string): string {
  return String(raw || '').trim().toLowerCase();
}

export function isValidPaypalEmail(raw: string): boolean {
  const email = normalizePaypalEmail(raw);
  // Practical email check — PayPal rejects bad receivers at payout time.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200;
}

async function getAccessToken(): Promise<string> {
  const clientId = String(process.env.PAYPAL_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.PAYPAL_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    throw new EconomyError('PAYPAL_NOT_CONFIGURED', 503, 'PayPal is not configured');
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(`${paypalApiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || !body?.access_token) {
    logger.error(
      { status: res.status, name: body?.name, message: body?.error_description || body?.message },
      '[paypal] oauth token failed',
    );
    throw new EconomyError('PROVIDER_ERROR', 502, 'PayPal auth failed', {
      reason: 'PAYPAL_OAUTH_FAILED',
      userMessage: 'PayPal could not authenticate. Check Business app credentials / Payouts enablement.',
    });
  }
  return String(body.access_token);
}

/**
 * Send a single GBP payout to a PayPal email.
 * amountMinor = pence (e.g. 1000 gems × 1p = 1000 → £10.00).
 */
export async function sendPaypalPayout(input: {
  withdrawalId: string;
  paypalEmail: string;
  amountMinor: number;
  currency?: string;
  note?: string;
}): Promise<{ batchId: string; payoutItemId?: string; status: string }> {
  if (!paypalConfigured()) {
    throw new EconomyError('PAYPAL_NOT_CONFIGURED', 503, 'PayPal is not configured', {
      reason: 'PAYPAL_NOT_CONFIGURED',
      userMessage:
        'PayPal Payouts is not configured. Ops can mark paid after a manual PayPal send, or add PAYPAL_CLIENT_ID/SECRET.',
    });
  }

  const email = normalizePaypalEmail(input.paypalEmail);
  if (!isValidPaypalEmail(email)) {
    throw new EconomyError('INVALID_INPUT', 400, 'Invalid PayPal email');
  }

  const amountMinor = Math.floor(Number(input.amountMinor));
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
    throw new EconomyError('INVALID_INPUT', 400, 'Invalid PayPal amount');
  }
  const currency = String(input.currency || getEconomyEnv().STRIPE_PLATFORM_CURRENCY || 'gbp')
    .trim()
    .toUpperCase() || 'GBP';
  const value = (amountMinor / 100).toFixed(2);
  const token = await getAccessToken();
  const senderBatchId = `blyp-wd-${String(input.withdrawalId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 40)}`;

  const payload = {
    sender_batch_header: {
      sender_batch_id: senderBatchId,
      email_subject: 'Blyp creator payout',
      email_message: 'You received a Blyp gem withdrawal.',
    },
    items: [
      {
        recipient_type: 'EMAIL',
        amount: { value, currency },
        receiver: email,
        note: String(input.note || `Blyp withdrawal ${input.withdrawalId}`).slice(0, 200),
        sender_item_id: String(input.withdrawalId).slice(0, 120),
      },
    ],
  };

  const res = await fetch(`${paypalApiBase()}/v1/payments/payouts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': senderBatchId,
    },
    body: JSON.stringify(payload),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const name = String(body?.name || body?.message || `HTTP_${res.status}`);
    logger.error(
      { status: res.status, name, details: body?.details || null, withdrawalId: input.withdrawalId },
      '[paypal] payout create failed',
    );
    throw new EconomyError('PROVIDER_ERROR', 502, 'PayPal payout failed', {
      reason: 'PAYPAL_PAYOUT_FAILED',
      providerMessage: name,
      userMessage:
        /AUTHORIZATION|PERMISSION|NOT_AUTHORIZED|PAYOUT/i.test(name)
          ? 'PayPal Business needs Payouts enabled for this app. Enable Payouts, then retry approve.'
          : 'PayPal could not send this payout. Check the receiver email and Business balance, then retry.',
    });
  }

  const batchId = String(body?.batch_header?.payout_batch_id || body?.batch_header?.payout_batch_id || '');
  const status = String(body?.batch_header?.batch_status || 'PENDING');
  return {
    batchId: batchId || senderBatchId,
    status,
  };
}
