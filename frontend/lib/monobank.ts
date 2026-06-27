export type MonobankCheckout = { pageUrl: string; invoiceId: string };

/** Monobank's hosted invoice page is a plain redirect, unlike LiqPay's form POST. */
export function redirectToMonobank(checkout: MonobankCheckout) {
  window.location.href = checkout.pageUrl;
}
