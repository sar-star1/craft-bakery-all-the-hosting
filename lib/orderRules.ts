// Ordering numbers. The defaults live here (safe for client code); the team can
// change the live values in Settings → they're stored in site_content under
// "ordering_rules" and read server-side with getOrderingRules (lib/orders.ts).
export interface OrderingRules {
  /** Smallest order (sum of the items, UAH) that is accepted at all. */
  min_order_total: number;
  /** Items total from which delivery is free. */
  free_delivery_from: number;
  /** Delivery fee below that total. */
  delivery_fee: number;
}

export const DEFAULT_ORDERING_RULES: OrderingRules = {
  min_order_total: 1000,
  free_delivery_from: 2000,
  delivery_fee: 250,
};

// Kept for existing imports.
export const MIN_ORDER_TOTAL_UAH = DEFAULT_ORDERING_RULES.min_order_total;

export type PaymentMethod = "cash" | "cashless";
export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: "Готівка",
  cashless: "Безготівка",
};

export function deliveryFor(goodsTotal: number, rules: OrderingRules): number {
  return goodsTotal >= rules.free_delivery_from ? 0 : rules.delivery_fee;
}
