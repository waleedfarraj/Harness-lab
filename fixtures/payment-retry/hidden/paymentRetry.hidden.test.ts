import assert from "node:assert/strict";
import { test } from "node:test";
import { retryPayment } from "../src/paymentRetry";
import type { PaymentAttemptResult } from "../src/paymentRetry";

/**
 * Evaluator-only tests. These are not shown to the coding agent while it
 * works; HarnessLab copies this file in only to score the finished
 * workspace. They check the same spec as the public tests from different
 * angles so a solution that merely pattern-matches the public tests still
 * has to get the underlying behavior right.
 */

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

test("maxAttempts of 1 means a transient failure is never retried", async () => {
  const attempt = scripted([{ ok: false, kind: "transient", message: "gateway timeout" }]);
  const outcome = await retryPayment(attempt.fn, { maxAttempts: 1 });
  assert.equal(outcome.success, false);
  assert.equal(outcome.attempts, 1);
  assert.equal(attempt.calls(), 1);
});

test("attemptPayment is never called more than maxAttempts times", async () => {
  const attempt = scripted([
    { ok: false, kind: "transient", message: "gateway timeout" },
    { ok: false, kind: "transient", message: "gateway timeout" },
    { ok: false, kind: "transient", message: "gateway timeout" },
    { ok: false, kind: "transient", message: "gateway timeout" },
  ]);
  const outcome = await retryPayment(attempt.fn, { maxAttempts: 4 });
  assert.equal(attempt.calls(), 4, "must not exceed maxAttempts");
  assert.equal(outcome.attempts, 4);
  assert.equal(outcome.success, false);
});

test("the reported attempt count always matches the real number of calls made", async () => {
  const attempt = scripted([
    { ok: false, kind: "transient", message: "gateway timeout" },
    { ok: false, kind: "transient", message: "gateway timeout" },
    { ok: true, transactionId: "tx_9" },
  ]);
  const outcome = await retryPayment(attempt.fn, { maxAttempts: 6 });
  assert.equal(outcome.attempts, attempt.calls());
  assert.equal(outcome.attempts, 3);
  assert.equal(outcome.success, true);
});
