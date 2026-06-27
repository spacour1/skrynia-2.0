import { nanoid } from "nanoid";

export type PaymentProviderName = "mock" | "stripe" | "liqpay" | "fondy";

export type PaymentResult = {
  provider: PaymentProviderName;
  reference: string;
  status: "captured";
};

export interface PaymentProvider {
  name: PaymentProviderName;
  capture(input: {
    orderId: string;
    amountCents: number;
    currency: string;
    idempotencyKey: string;
    /** Transaction id already confirmed by the provider (e.g. a verified webhook). */
    externalReference?: string;
  }): Promise<PaymentResult>;
}

class SimulatedProvider implements PaymentProvider {
  private capturedByIdempotencyKey = new Map<string, PaymentResult>();

  constructor(public name: PaymentProviderName) {}

  async capture(input: {
    orderId: string;
    amountCents: number;
    currency: string;
    idempotencyKey: string;
  }): Promise<PaymentResult> {
    const existing = this.capturedByIdempotencyKey.get(input.idempotencyKey);
    if (existing) return existing;

    const result: PaymentResult = {
      provider: this.name,
      reference: `${this.name}_${input.orderId}_${nanoid(10)}`,
      status: "captured"
    };
    this.capturedByIdempotencyKey.set(input.idempotencyKey, result);
    return result;
  }
}

/**
 * LiqPay payment confirmation happens asynchronously, off-process, via the LiqPay
 * server_url webhook (see liqpay.service.ts) before lockEscrow ever runs. By the time
 * this is called, the payment is already verified — capture() just records the real
 * LiqPay payment_id as the reference instead of minting a synthetic one.
 */
class LiqpayCaptureProvider implements PaymentProvider {
  public name: PaymentProviderName = "liqpay";

  async capture(input: {
    orderId: string;
    amountCents: number;
    currency: string;
    idempotencyKey: string;
    externalReference?: string;
  }): Promise<PaymentResult> {
    if (!input.externalReference) {
      throw new Error("LiqPay capture requires a confirmed externalReference from the payment webhook");
    }
    return { provider: "liqpay", reference: input.externalReference, status: "captured" };
  }
}

const providers: Record<PaymentProviderName, PaymentProvider> = {
  mock: new SimulatedProvider("mock"),
  stripe: new SimulatedProvider("stripe"),
  liqpay: new LiqpayCaptureProvider(),
  fondy: new SimulatedProvider("fondy")
};

export function getPaymentProvider(name: PaymentProviderName) {
  return providers[name];
}
