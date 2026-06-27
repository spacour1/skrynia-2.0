"use client";

import { useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, CircleDollarSign, Hourglass, LockKeyhole, Search, ShieldCheck, WalletCards, type LucideIcon } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RequireAuth } from "../../components/RequireAuth";
import { ApiError, apiFetch, money } from "../../lib/api";
import { redirectToLiqpay, type LiqpayCheckout } from "../../lib/liqpay";
import { redirectToMonobank, type MonobankCheckout } from "../../lib/monobank";
import { redirectToWayforpay, type WayforpayCheckout } from "../../lib/wayforpay";

type WalletItem = {
  id: string;
  currency: string;
  availableCents: number;
  escrowCents: number;
};

type WalletTransaction = {
  id: string;
  type: string;
  direction: string;
  amountCents: number;
  currency: string;
  status: string;
  orderId?: string;
  createdAt: string;
};

type WalletResponse = {
  wallet?: WalletItem | null;
  wallets?: WalletItem[];
  transactions: WalletTransaction[];
};

const tabs = [
  ["all", "Все"],
  ["wallet_credit", "Пополнения"],
  ["payment_capture", "Покупки"],
  ["escrow_release", "Продажи"],
  ["wallet_debit", "Вывод"],
  ["escrow", "Escrow"]
];

export default function WalletPage() {
  return (
    <RequireAuth>
      <WalletContent />
    </RequireAuth>
  );
}

function WalletContent() {
  const client = useQueryClient();
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [topupOpen, setTopupOpen] = useState(false);
  const [topupAmount, setTopupAmount] = useState("");
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawCardNumber, setWithdrawCardNumber] = useState("");
  const [withdrawHolderName, setWithdrawHolderName] = useState("");

  const wallet = useQuery({
    queryKey: ["wallet"],
    queryFn: () => apiFetch<WalletResponse>("/users/me/wallet")
  });

  const transactions = wallet.data?.transactions ?? [];
  const wallets = wallet.data?.wallets ?? (wallet.data?.wallet ? [wallet.data.wallet] : []);
  const primary = wallet.data?.wallet ?? wallets[0] ?? { currency: "UAH", availableCents: 0, escrowCents: 0 };
  const processingCents = sumTransactions(transactions.filter((tx) => tx.status !== "completed" && tx.status !== "succeeded"));

  const topupWithLiqpay = useMutation({
    mutationFn: () =>
      apiFetch<LiqpayCheckout>("/payments/wallet/liqpay/checkout", {
        method: "POST",
        body: JSON.stringify({ amount: topupAmount.trim() })
      }),
    onSuccess: redirectToLiqpay
  });

  const topupWithMonobank = useMutation({
    mutationFn: () =>
      apiFetch<MonobankCheckout>("/payments/wallet/monobank/checkout", {
        method: "POST",
        body: JSON.stringify({ amount: topupAmount.trim() })
      }),
    onSuccess: redirectToMonobank
  });

  const topupWithWayforpay = useMutation({
    mutationFn: () =>
      apiFetch<WayforpayCheckout>("/payments/wallet/wayforpay/checkout", {
        method: "POST",
        body: JSON.stringify({ amount: topupAmount.trim() })
      }),
    onSuccess: redirectToWayforpay
  });

  const withdraw = useMutation({
    mutationFn: () =>
      apiFetch("/users/me/wallet/withdraw", {
        method: "POST",
        body: JSON.stringify({
          amount: withdrawAmount.trim(),
          currency: primary.currency,
          destination: {
            method: "card",
            accountNumber: withdrawCardNumber.trim(),
            holderName: withdrawHolderName.trim()
          }
        })
      }),
    onSuccess: () => {
      setWithdrawOpen(false);
      setWithdrawAmount("");
      setWithdrawCardNumber("");
      setWithdrawHolderName("");
      client.invalidateQueries({ queryKey: ["wallet"] });
    }
  });

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return transactions.filter((tx) => {
      const byTab = tab === "all" || tx.type === tab || (tab === "escrow" && tx.type.includes("escrow"));
      const label = `${tx.type} ${tx.status} ${tx.orderId ?? ""}`.toLowerCase();
      return byTab && (!needle || label.includes(needle));
    });
  }, [transactions, q, tab]);

  return (
    <div className="mx-auto max-w-[1180px] space-y-8">
      <section className="space-y-2">
        <h1 className="text-3xl font-black text-ink">Кошелек</h1>
        <p className="text-sm text-muted">Управляйте балансом и просматривайте историю операций.</p>
      </section>

      <section className="grid gap-5 lg:grid-cols-3">
        <article className="rounded-lg border border-brand/60 bg-card p-6 shadow-[0_0_0_1px_rgba(250,204,21,0.08),0_20px_60px_rgba(0,0,0,0.28)]">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 place-items-center rounded-lg bg-brand/10 text-brand">
              <WalletCards className="h-6 w-6" />
            </span>
            <div>
              <p className="text-sm font-bold text-muted">Доступно к выводу</p>
              <p className="mt-2 text-3xl font-black text-ink">{money(primary.availableCents, primary.currency)}</p>
              <p className="mt-2 text-sm text-muted">Можно вывести прямо сейчас</p>
            </div>
          </div>
          <div className="mt-6 grid gap-3">
            <button
              className="app-button-action h-12"
              onClick={() => {
                setTopupOpen((value) => !value);
                setWithdrawOpen(false);
              }}
            >
              <ArrowDownToLine className="h-5 w-5" />
              Пополнить баланс
            </button>
            {topupOpen ? (
              <div className="rounded-lg border border-line bg-panel/35 p-3">
                <label className="block space-y-2">
                  <span className="block text-xs font-bold text-muted">Сумма пополнения, {primary.currency}</span>
                  <input
                    className="app-input h-11 w-full"
                    type="number"
                    min="1"
                    step="0.01"
                    placeholder="0.00"
                    value={topupAmount}
                    onChange={(event) => setTopupAmount(event.target.value)}
                  />
                </label>
                <div className="mt-3 grid gap-2">
                  <button className="app-button-action h-11 w-full" disabled={!topupAmount || topupWithLiqpay.isPending} onClick={() => topupWithLiqpay.mutate()}>
                    {topupWithLiqpay.isPending ? "Переходим к оплате..." : "Перейти к оплате через LiqPay"}
                  </button>
                  <button className="app-button-action h-11 w-full" disabled={!topupAmount || topupWithMonobank.isPending} onClick={() => topupWithMonobank.mutate()}>
                    {topupWithMonobank.isPending ? "Переходим к оплате..." : "Перейти к оплате через Monobank"}
                  </button>
                  <button className="app-button-action h-11 w-full" disabled={!topupAmount || topupWithWayforpay.isPending} onClick={() => topupWithWayforpay.mutate()}>
                    {topupWithWayforpay.isPending ? "Переходим к оплате..." : "Перейти к оплате через WayForPay"}
                  </button>
                </div>
                {topupWithLiqpay.error ? <p className="mt-2 text-sm text-rose-600">{(topupWithLiqpay.error as ApiError).message}</p> : null}
                {topupWithMonobank.error ? <p className="mt-2 text-sm text-rose-600">{(topupWithMonobank.error as ApiError).message}</p> : null}
                {topupWithWayforpay.error ? <p className="mt-2 text-sm text-rose-600">{(topupWithWayforpay.error as ApiError).message}</p> : null}
              </div>
            ) : null}

            <button
              className="app-button-secondary h-12"
              onClick={() => {
                setWithdrawOpen((value) => !value);
                setTopupOpen(false);
              }}
            >
              <ArrowUpFromLine className="h-5 w-5" />
              Вывести средства
            </button>
            {withdrawOpen ? (
              <div className="rounded-lg border border-line bg-panel/35 p-3">
                <label className="block space-y-2">
                  <span className="block text-xs font-bold text-muted">Сумма вывода, {primary.currency}</span>
                  <input
                    className="app-input h-11 w-full"
                    type="number"
                    min="1"
                    step="0.01"
                    placeholder="0.00"
                    value={withdrawAmount}
                    onChange={(event) => setWithdrawAmount(event.target.value)}
                  />
                </label>
                <label className="mt-3 block space-y-2">
                  <span className="block text-xs font-bold text-muted">Номер карты для вывода</span>
                  <input
                    className="app-input h-11 w-full"
                    type="text"
                    placeholder="0000 0000 0000 0000"
                    value={withdrawCardNumber}
                    onChange={(event) => setWithdrawCardNumber(event.target.value)}
                  />
                </label>
                <label className="mt-3 block space-y-2">
                  <span className="block text-xs font-bold text-muted">Получатель (как на карте)</span>
                  <input
                    className="app-input h-11 w-full"
                    type="text"
                    placeholder="Иван Иванов"
                    value={withdrawHolderName}
                    onChange={(event) => setWithdrawHolderName(event.target.value)}
                  />
                </label>
                <p className="mt-2 text-xs text-muted">
                  Заявка проверяется вручную: администратор переводит деньги на указанную карту и подтверждает выплату.
                </p>
                <button
                  className="app-button mt-3 h-11 w-full"
                  disabled={!withdrawAmount || !withdrawCardNumber || !withdrawHolderName || withdraw.isPending}
                  onClick={() => withdraw.mutate()}
                >
                  {withdraw.isPending ? "Отправляем заявку..." : "Подтвердить вывод"}
                </button>
                {withdraw.error ? <p className="mt-2 text-sm text-rose-600">{(withdraw.error as ApiError).message}</p> : null}
              </div>
            ) : null}
          </div>
        </article>

        <BalanceCard icon={ShieldCheck} label="В Escrow" value={money(primary.escrowCents, primary.currency)} text="Ожидают завершения сделки" accent="text-brand" />
        <BalanceCard icon={Hourglass} label="В обработке" value={money(processingCents, primary.currency)} text="Пополнения и выводы в процессе" accent="text-sky-400" />
      </section>

      <section className="app-card overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-line bg-panel/45 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-black text-ink">История операций</h2>
            <div className="relative mt-4 w-full lg:w-[360px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input className="app-input h-11 w-full pl-10" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Поиск по операциям..." />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {tabs.map(([value, label]) => (
              <button
                key={value}
                className={`rounded-lg px-3 py-2 text-sm font-bold transition ${tab === value ? "bg-brand text-stone-950" : "bg-card text-muted hover:bg-panel hover:text-ink"}`}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto p-5">
          <table className="min-w-[820px] w-full border-separate border-spacing-0">
            <thead>
              <tr className="text-left text-xs font-bold uppercase text-muted">
                <th className="py-3">Операция</th>
                <th className="py-3">Дата</th>
                <th className="py-3">Статус</th>
                <th className="py-3 text-right">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((tx) => (
                <tr key={tx.id} className="border-b border-line">
                  <td className="border-t border-line py-4">
                    <div className="flex items-center gap-3">
                      <span className={`grid h-10 w-10 place-items-center rounded-lg ${tx.direction === "credit" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>
                        {tx.type.includes("escrow") ? <LockKeyhole className="h-5 w-5" /> : <CircleDollarSign className="h-5 w-5" />}
                      </span>
                      <span>
                        <span className="block font-bold text-ink">{labelTx(tx.type)}</span>
                        <span className="mt-1 block text-xs text-muted">{tx.orderId ? `Заказ #${tx.orderId.slice(0, 8)}` : tx.direction === "credit" ? "Пополнение" : "Списание"}</span>
                      </span>
                    </div>
                  </td>
                  <td className="border-t border-line py-4 text-sm text-muted">{formatDate(tx.createdAt)}</td>
                  <td className="border-t border-line py-4">
                    <span className={`rounded px-2 py-1 text-xs font-bold ${statusClass(tx.status, tx.type)}`}>{statusLabel(tx.status, tx.type)}</span>
                  </td>
                  <td className={`border-t border-line py-4 text-right font-black ${tx.direction === "credit" ? "text-emerald-400" : "text-rose-400"}`}>
                    {tx.direction === "credit" ? "+" : "-"}
                    {money(tx.amountCents, tx.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!wallet.isLoading && !filtered.length ? <p className="py-10 text-center text-sm text-muted">Операций пока нет.</p> : null}
          {wallet.isLoading ? <p className="py-10 text-center text-sm text-muted">Загружаем операции...</p> : null}
        </div>
      </section>

      <p className="flex items-center justify-center gap-2 text-sm text-muted">
        <LockKeyhole className="h-4 w-4" />
        Безопасные платежи и выплаты
      </p>
    </div>
  );
}

function BalanceCard({ icon: Icon, label, value, text, accent }: { icon: LucideIcon; label: string; value: string; text: string; accent: string }) {
  return (
    <article className="rounded-lg border border-line bg-card p-8">
      <Icon className={`h-7 w-7 ${accent}`} />
      <p className="mt-5 text-sm font-bold text-muted">{label}</p>
      <p className={`mt-3 text-2xl font-black ${accent}`}>{value}</p>
      <p className="mt-4 max-w-[190px] text-sm leading-6 text-muted">{text}</p>
    </article>
  );
}

function sumTransactions(transactions: WalletTransaction[]) {
  return transactions.reduce((sum, tx) => sum + Number(tx.amountCents), 0);
}

function labelTx(type: string) {
  const labels: Record<string, string> = {
    payment_capture: "Оплата заказа",
    escrow_hold: "Продажа товара",
    escrow_release: "Выплата по заказу",
    platform_fee: "Комиссия площадки",
    refund: "Возврат средств",
    wallet_credit: "Пополнение баланса",
    wallet_debit: "Вывод средств"
  };
  return labels[type] ?? type.replaceAll("_", " ");
}

function statusLabel(status: string, type: string) {
  if (type.includes("escrow")) return "В Escrow";
  if (status === "completed" || status === "succeeded") return "Завершено";
  if (status === "pending") return "В обработке";
  return status;
}

function statusClass(status: string, type: string) {
  if (type.includes("escrow")) return "bg-brand/10 text-brand";
  if (status === "completed" || status === "succeeded") return "bg-emerald-500/10 text-emerald-400";
  if (status === "pending") return "bg-sky-500/10 text-sky-400";
  return "bg-panel text-muted";
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
