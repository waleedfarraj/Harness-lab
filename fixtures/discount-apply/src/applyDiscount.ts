import type { DiscountCode } from "./discountContract";

export type DiscountResult =
  | { ok: true; percentOff: number }
  | { ok: false; reason: "not_found" | "below_minimum" | "expired" };

/**
 * Applies a discount code to an order subtotal.
 *
 * TODO(discount-apply-001): stub. Always reports "not_found" and does not
 * implement any of the catalog lookup, minimum-spend, or expiry rules. See
 * discountContract.ts for the exact validation rules.
 */
export function applyDiscount(subtotal: number, code: string, catalog: DiscountCode[], now: string): DiscountResult {
  return { ok: false, reason: "not_found" };
}
