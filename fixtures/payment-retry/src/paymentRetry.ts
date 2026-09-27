/**
 * A single attempt to charge a payment.
 *
 * - `ok: true` means the charge succeeded.
 * - `ok: false, kind: "transient"` means a temporary failure (e.g. a timeout
 *   or a rate limit) that may succeed if retried.
 * - `ok: false, kind: "permanent"` means a validation or business-rule
 *   failure (e.g. an invalid card or insufficient funds) that will never
 *   succeed no matter how many times it is retried.
 */
export type PaymentAttemptResult =
  | { ok: true; transactionId: string }
  | { ok: false; kind: "transient" | "permanent"; message: string };

export interface RetryOptions {
  /** Maximum number of attempts to make, including the first one. Must be >= 1. */
  maxAttempts: number;
}

export interface RetryOutcome {
  success: boolean;
  /** How many times `attemptPayment` was called. */
  attempts: number;
  lastError?: { kind: "transient" | "permanent"; message: string };
}

/**
 * Charges a payment, retrying on transient failures only.
 *
 * TODO(payment-retry-001): this is a stub. It currently makes exactly one
 * attempt and returns whatever that attempt reports, ignoring
 * `maxAttempts` and never retrying transient failures.
 *
 * Required behavior:
 *   1. Transient failures may be retried, up to `maxAttempts` total attempts.
 *   2. Permanent (validation) failures must never be retried: stop and
 *      return failure immediately after the first permanent failure.
 *   3. Never call `attemptPayment` more than `maxAttempts` times.
 *   4. A successful attempt returns immediately without further attempts.
 */
export async function retryPayment(
  attemptPayment: () => Promise<PaymentAttemptResult>,
  options: RetryOptions,
): Promise<RetryOutcome> {
  const result = await attemptPayment();

  if (result.ok) {
    return { success: true, attempts: 1 };
  }

  return {
    success: false,
    attempts: 1,
    lastError: { kind: result.kind, message: result.message },
  };
}
