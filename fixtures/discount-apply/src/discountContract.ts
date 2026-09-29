/**
 * Discount contract.
 *
 * A discount code is valid only if:
 *  - it exists in the catalog, and
 *  - the order subtotal meets the code's minimum spend, and
 *  - the code has not expired (expiresAt has not passed as of `now`).
 *
 * IMPORTANT: an EXPIRED code must be reported with reason "expired", not
 * "not_found". Downstream billing reporting depends on this distinction to
 * flag codes customers are trying to use after expiry, separately from
 * codes that were simply mistyped or never existed.
 */
export interface DiscountCode {
  code: string;
  percentOff: number;
  minSubtotal: number;
  /** ISO 8601 date string. */
  expiresAt: string;
}
