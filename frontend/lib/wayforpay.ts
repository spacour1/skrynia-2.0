export type WayforpayCheckout = { invoiceUrl: string };

/** WayForPay's invoice API hands back a hosted page URL — same shape as Monobank's. */
export function redirectToWayforpay(checkout: WayforpayCheckout) {
  window.location.href = checkout.invoiceUrl;
}
