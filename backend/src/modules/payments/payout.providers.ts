export type PayoutProviderName = "manual" | "liqpay";

export type PayoutDestination = {
  method: "card" | "iban";
  accountNumber: string;
  holderName: string;
  bankName?: string;
};

export type PayoutResult = {
  provider: PayoutProviderName;
  reference: string;
  status: "paid";
};

export interface PayoutProvider {
  name: PayoutProviderName;
  payout(input: {
    payoutId: string;
    amountCents: number;
    currency: string;
    destination: PayoutDestination;
    adminReference?: string;
  }): Promise<PayoutResult>;
}

/**
 * No automated bank rail is wired up yet: an admin wires the transfer themselves using the
 * destination on file, then confirms it here with the bank's own transaction reference,
 * the same human-in-the-loop pattern as the manual top-up confirmation flow.
 */
class ManualPayoutProvider implements PayoutProvider {
  public name: PayoutProviderName = "manual";

  async payout(input: { payoutId: string; adminReference?: string }): Promise<PayoutResult> {
    if (!input.adminReference) {
      throw new Error("Manual payout requires an admin-supplied bank transaction reference");
    }
    return { provider: "manual", reference: input.adminReference, status: "paid" };
  }
}

/**
 * Placeholder for LiqPay's P2P payout API: that requires a separate merchant agreement
 * from card acquiring and isn't wired up yet. This throws instead of pretending money
 * moved, so it can't be selected as a real payout path until the integration lands.
 */
class LiqpayPayoutProvider implements PayoutProvider {
  public name: PayoutProviderName = "liqpay";

  async payout(): Promise<PayoutResult> {
    throw new Error("LiqPay payout integration is not implemented yet");
  }
}

const providers: Record<PayoutProviderName, PayoutProvider> = {
  manual: new ManualPayoutProvider(),
  liqpay: new LiqpayPayoutProvider()
};

export function getPayoutProvider(name: PayoutProviderName) {
  return providers[name];
}
