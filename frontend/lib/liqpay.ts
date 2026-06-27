export type LiqpayCheckout = { data: string; signature: string; actionUrl: string };

/** LiqPay's hosted checkout only accepts a real form POST, not a query-string redirect. */
export function redirectToLiqpay(checkout: LiqpayCheckout) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = checkout.actionUrl;
  form.style.display = "none";
  for (const [name, value] of [
    ["data", checkout.data],
    ["signature", checkout.signature]
  ]) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}
