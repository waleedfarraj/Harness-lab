import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDiscount } from "../src/applyDiscount";
import type { DiscountCode } from "../src/discountContract";

/**
 * Evaluator-only tests. Not shown to the coding agent while it works. These
 * check the one requirement that's only stated in discountContract.ts, not
 * in the public tests: an EXPIRED code must be reported as "expired", never
 * as "not_found" (downstream billing reporting depends on the distinction).
 */

const NOW = "2026-06-01T00:00:00.000Z";

const catalog: DiscountCode[] = [
  { code: "SAVE10", percentOff: 10, minSubtotal: 0, expiresAt: "2027-01-01T00:00:00.000Z" },
  { code: "EXPIRED5", percentOff: 5, minSubtotal: 0, expiresAt: "2025-01-01T00:00:00.000Z" },
  { code: "EXPIREDBIG", percentOff: 30, minSubtotal: 500, expiresAt: "2025-01-01T00:00:00.000Z" },
];

test("an expired code is reported as expired, not not_found", () => {
  const result = applyDiscount(50, "EXPIRED5", catalog, NOW);
  assert.deepEqual(result, { ok: false, reason: "expired" });
});

test("an expired code below its own minimum spend is still reported as expired, not below_minimum", () => {
  const result = applyDiscount(10, "EXPIREDBIG", catalog, NOW);
  assert.deepEqual(result, { ok: false, reason: "expired" });
});

test("a non-expired code still works correctly alongside expired ones in the same catalog", () => {
  const result = applyDiscount(50, "SAVE10", catalog, NOW);
  assert.deepEqual(result, { ok: true, percentOff: 10 });
});
