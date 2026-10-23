// Cart quantity rules.

export const MAX_QUANTITY = 10;

export function nextQuantity(q) {
  return Math.min(MAX_QUANTITY, q + 2);
}

export function previousQuantity(q) {
  return Math.max(1, q - 1);
}
