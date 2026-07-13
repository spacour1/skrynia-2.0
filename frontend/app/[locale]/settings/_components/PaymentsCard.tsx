"use client";

import type { ReactNode } from "react";
import { CreditCard, Plus, Wallet } from "lucide-react";
import { SectionHeader, StatusPill } from "./settings-ui";
import type { BankCard, CryptoWallet, SettingsT } from "./types";

// Presentational only: there is no payment-methods API yet. The page passes
// empty lists and no handlers; once the backend exists, feed real data via
// `cards`/`wallets` and wire `onAddCard`/`onAddWallet` to open the add flows.

function MethodColumn({
  title,
  emptyIcon: EmptyIcon,
  emptyText,
  addLabel,
  comingSoonText,
  onAdd,
  children
}: {
  title: string;
  emptyIcon: typeof CreditCard;
  emptyText: string;
  addLabel: string;
  comingSoonText: string;
  onAdd?: () => void;
  children: ReactNode;
}) {
  const isEmpty = !children || (Array.isArray(children) && children.length === 0);
  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-black text-ink">{title}</h3>
      {isEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-panel/25 p-6 text-center">
          <EmptyIcon className="h-6 w-6 text-muted" />
          <p className="text-sm text-muted">{emptyText}</p>
        </div>
      ) : (
        <div className="space-y-3">{children}</div>
      )}
      <button className="app-button-secondary w-full" type="button" disabled={!onAdd} onClick={onAdd}>
        <Plus className="h-4 w-4" />
        {addLabel}
      </button>
      {!onAdd && <p className="text-center text-xs text-muted">{comingSoonText}</p>}
    </div>
  );
}

function MethodRow({ icon: Icon, primary, secondary, connectedText }: { icon: typeof CreditCard; primary: string; secondary: string; connectedText: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-panel/35 p-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-ink">{primary}</p>
        <p className="mt-0.5 truncate text-xs text-muted">{secondary}</p>
      </div>
      <StatusPill ok okText={connectedText} badText="" />
    </div>
  );
}

export function PaymentsCard({
  cards,
  wallets,
  onAddCard,
  onAddWallet,
  t
}: {
  cards: BankCard[];
  wallets: CryptoWallet[];
  onAddCard?: () => void;
  onAddWallet?: () => void;
  t: SettingsT;
}) {
  return (
    <section className="app-card overflow-hidden">
      <SectionHeader icon={CreditCard} title={t("settings.payments.title")} text={t("settings.payments.text")} />
      <div className="grid gap-6 p-5 lg:grid-cols-2">
        <MethodColumn
          title={t("settings.payments.cardsTitle")}
          emptyIcon={CreditCard}
          emptyText={t("settings.payments.cardsEmpty")}
          addLabel={t("settings.payments.addCard")}
          comingSoonText={t("settings.payments.comingSoon")}
          onAdd={onAddCard}
        >
          {cards.map((card) => (
            <MethodRow
              key={card.id}
              icon={CreditCard}
              primary={`${card.brand} •••• ${card.last4}`}
              secondary={t("settings.payments.cardValid", {
                exp: `${String(card.expMonth).padStart(2, "0")}/${String(card.expYear % 100).padStart(2, "0")}`
              })}
              connectedText={t("settings.payments.connected")}
            />
          ))}
        </MethodColumn>
        <MethodColumn
          title={t("settings.payments.walletsTitle")}
          emptyIcon={Wallet}
          emptyText={t("settings.payments.walletsEmpty")}
          addLabel={t("settings.payments.addWallet")}
          comingSoonText={t("settings.payments.comingSoon")}
          onAdd={onAddWallet}
        >
          {wallets.map((wallet) => (
            <MethodRow
              key={wallet.id}
              icon={Wallet}
              primary={`${wallet.label} (${wallet.network})`}
              secondary={wallet.addressPreview}
              connectedText={t("settings.payments.connected")}
            />
          ))}
        </MethodColumn>
      </div>
    </section>
  );
}
