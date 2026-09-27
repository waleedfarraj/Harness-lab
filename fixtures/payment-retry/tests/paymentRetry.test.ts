import assert from "node:assert/strict";
import { test } from "node:test";
import { retryPayment } from "../src/paymentRetry";
import type { PaymentAttemptResult } from "../src/paymentRetry";

/** Returns an attemptPayment fn that yields `results` in order, one per call. */
function scripted(results: PaymentAttemptResult[]): { fn: () => Promise<PaymentAttemptResult>; calls: () => number } {
  let i = 0;
  return {
    fn: async () => {
      const result = results[Math.min(i, results.length - 1)];
      i += 1;
      return result;
    },
    calls: () => i,
  };
}

test("a successful first attempt returns immediately", async () => {
  const attempt = scripted([{ ok: true, transactionId: "tx_1" }]);
  const outcome = await retryPayment(attempt.fn, { maxAttempts: 5 });
  assert.equal(outcome.success, true);
  assert.equal(outcome.attempts, 1);
  assert.equal(attempt.calls(), 1);
});

test("a transient failure is retried until it succeeds", async () => {
  const attempt = scripted([
    { ok: false, kind: "transient", message: "gateway timeout" },
    { ok: false, kind: "transient", message: "gateway timeout" },
    { ok: true, transactionId: "tx_2" },
  ]);
  const outcome = await retryPayment(attempt.fn, { maxAttempts: 5 });
  assert.equal(outcome.success, true);
  assert.equal(outcome.attempts, 3);
});

test("transient failures stop after maxAttempts and report the last error", async () => {
  const attempt = scripted([
    { ok: false, kind: "transient", message: "gateway timeout" },
    { ok: false, kind: "transient", message: "gateway timeout" },
    { ok: false, kind: "transient", message: "gateway timeout" },
  ]);
  const outcome = await retryPayment(attempt.fn, { maxAttempts: 3 });
  assert.equal(outcome.success, false);
  assert.equal(outcome.attempts, 3);
  assert.equal(outcome.lastError?.kind, "transient");
});

test("a permanent (validation) failure is never retried", async () => {
  const attempt = scripted([{ ok: false, kind: "permanent", message: "invalid card number" }]);
  const outcome = await retryPayment(attempt.fn, { maxAttempts: 5 });
  assert.equal(outcome.success, false);
  assert.equal(outcome.attempts, 1);
  assert.equal(attempt.calls(), 1, "a permanent failure must not be retried");
  assert.equal(outcome.lastError?.kind, "permanent");
});

test("a permanent failure after some transient failures still stops immediately", async () => {
  const attempt = scripted([
    { ok: false, kind: "transient", message: "gateway timeout" },
    { ok: false, kind: "permanent", message: "insufficient funds" },
  ]);
  const outcome = await retryPayment(attempt.fn, { maxAttempts: 10 });
  assert.equal(outcome.success, false);
  assert.equal(outcome.attempts, 2);
  assert.equal(attempt.calls(), 2, "must stop at the permanent failure, not keep retrying to maxAttempts");
  assert.equal(outcome.lastError?.kind, "permanent");
});
