import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDiscount } from "../src/applyDiscount";
import type { DiscountCode } from "../src/discountContract";

const NOW = "2026-06-01T00:00:00.000Z";

const catalog: DiscountCode[] = [
  { code: "SAVE10", percentOff: 10, minSubtotal: 0, expiresAt: "2027-01-01T00:00:00.000Z" },
  { code: "BIGSPENDER", percentOff: 25, minSubtotal: 200, expiresAt: "2027-01-01T00:00:00.000Z" },
];

test("applies the discount when the code exists and the subtotal meets the minimum", () => {
  const result = applyDiscount(50, "SAVE10", catalog, NOW);
  assert.deepEqual(result, { ok: true, percentOff: 10 });
});

test("returns not_found for a code that isn't in the catalog", () => {
  const result = applyDiscount(50, "NOPE", catalog, NOW);
  assert.deepEqual(result, { ok: false, reason: "not_found" });
});

test("returns below_minimum when the subtotal is under the code's minimum spend", () => {
  const result = applyDiscount(100, "BIGSPENDER", catalog, NOW);
  assert.deepEqual(result, { ok: false, reason: "below_minimum" });
});

test("applies the discount when the subtotal exactly meets the minimum spend", () => {
  const result = applyDiscount(200, "BIGSPENDER", catalog, NOW);
  assert.deepEqual(result, { ok: true, percentOff: 25 });
});
