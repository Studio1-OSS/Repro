// Order totals. Prices are in dollars with two decimals.

/** Applies a coupon from GET /api/coupons/:code to a subtotal. */
export function applyCoupon(subtotal, coupon) {
  const discount = (subtotal * coupon.discount?.rate) / 100;
  return { discount, total: subtotal - discount };
}

export const money = (n) => `$${n.toFixed(2)}`;
