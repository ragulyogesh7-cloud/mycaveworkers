import crypto from 'crypto';

function timingSafeEqualText(expected: string, provided: string): boolean {
  if (!expected || !provided || expected.length !== provided.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  } catch (_error) {
    return false;
  }
}

export function verifyRazorpayPaymentSignature(orderId: string, paymentId: string, signature: string, secret: string): boolean {
  if (!orderId || !paymentId || !signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  return timingSafeEqualText(expected, signature);
}

export function verifyRazorpayWebhookSignature(rawBody: Buffer | string, signature: string, secret: string): boolean {
  if (!rawBody || !signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return timingSafeEqualText(expected, signature);
}

export function isTrialExpired(tier: string | undefined, trialEndsAt: string | undefined, now = Date.now()): boolean {
  if (tier !== 'free_trial' || !trialEndsAt) return false;
  const endsAt = Date.parse(trialEndsAt);
  return Number.isFinite(endsAt) && now >= endsAt;
}
