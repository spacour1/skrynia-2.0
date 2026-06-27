import { nanoid } from "nanoid";

export type PaymentProviderName = "mock" | "stripe" | "liqpay" | "fondy" | "monobank" | "manual" | "wayforpay";

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

/**
 * Monobank's webhook (see monobank.service.ts) is the same kind of out-of-process
 * confirmation as LiqPay's: by the time this runs, getMonobankInvoiceStatus has already
 * confirmed the payment, so capture() just records the invoiceId as the reference.
 */
class MonobankCaptureProvider implements PaymentProvider {
  public name: PaymentProviderName = "monobank";

  async capture(input: {
    orderId: string;
    amountCents: number;
    currency: string;
    idempotencyKey: string;
    externalReference?: string;
  }): Promise<PaymentResult> {
    if (!input.externalReference) {
      throw new Error("Monobank capture requires a confirmed externalReference from the payment webhook");
    }
    return { provider: "monobank", reference: input.externalReference, status: "captured" };
  }
}

/**
 * There is no webhook for manual bank transfers — an admin reviews the incoming
 * transfer themselves and confirms it from the admin panel, so capture() is only ever
 * reached after that human review already happened.
 */
class ManualCaptureProvider implements PaymentProvider {
  public name: PaymentProviderName = "manual";

  async capture(input: {
    orderId: string;
    amountCents: number;
    currency: string;
    idempotencyKey: string;
    externalReference?: string;
  }): Promise<PaymentResult> {
    return { provider: "manual", reference: input.externalReference || `manual:${input.orderId}`, status: "captured" };
  }
}

/**
 * WayForPay's webhook (see wayforpay.service.ts) confirms via the same kind of
 * out-of-process re-check as Monobank/LiqPay: by the time this runs, getWayforpayStatus
 * has already confirmed "Approved", so capture() just records the orderReference.
 */
class WayforpayCaptureProvider implements PaymentProvider {
  public name: PaymentProviderName = "wayforpay";

  async capture(input: {
    orderId: string;
    amountCents: number;
    currency: string;
    idempotencyKey: string;
    externalReference?: string;
  }): Promise<PaymentResult> {
    if (!input.externalReference) {
      throw new Error("WayForPay capture requires a confirmed externalReference from the payment webhook");
    }
    return { provider: "wayforpay", reference: input.externalReference, status: "captured" };
  }
}

const providers: Record<PaymentProviderName, PaymentProvider> = {
  mock: new SimulatedProvider("mock"),
  stripe: new SimulatedProvider("stripe"),
  liqpay: new LiqpayCaptureProvider(),
  fondy: new SimulatedProvider("fondy"),
  monobank: new MonobankCaptureProvider(),
  manual: new ManualCaptureProvider(),
  wayforpay: new WayforpayCaptureProvider()
};

export function getPaymentProvider(name: PaymentProviderName) {
  return providers[name];
}
