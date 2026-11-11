import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { TransactionDetailPanel } from "../components/TransactionDetailPanel";
import { TransactionsEmptyIllustration } from "../components/illustrations";
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { PlusIcon, StatementUploadIcon } from "../components/icons";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { Button, Card, EmptyState, ListReveal, Pill, showError } from "../components";
import type { Transaction } from "../types/transaction";
import { formatCents } from "../utils/money";
import { maskAccountNumbers } from "../utils/mask";

// A statement-sourced vendorRaw is the statement's own Description column,
// which can carry an account number or IBAN verbatim -- mask it here
// (and everywhere outside the upload's own flow), never on the page the
// user views right after uploading.
function displayVendor(transaction: Transaction): string {
  return transaction.source === "statement_import" ? maskAccountNumbers(transaction.vendorRaw) : transaction.vendorRaw;
}

function TransactionRow({ transaction, onOpen }: { transaction: Transaction; onOpen: (transaction: Transaction) => void }) {

  return (
    <Card>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1 break-words">
          <span className="font-body font-semibold">{displayVendor(transaction)}</span>
          <button type="button" onClick={() => onOpen(transaction)} className="text-left">
            <Pill>{transaction.category}</Pill>
          </button>
          {transaction.suggestion && transaction.suggestionStatus === "pending" && <span className="font-body text-[12px] text-text-secondary">AI suggestion available</span>}
          {transaction.reviewStatus !== "committed" && <Pill tone="warning">{transaction.reviewStatus}</Pill>}
          {transaction.dedupResolution && transaction.dedupResolution !== "pending" && (
            <Pill tone="neutral">{transaction.dedupResolution}</Pill>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="font-body font-semibold">{formatCents(transaction.amount)}</span>
          {transaction.reviewStatus === "pending_review" && (
            <button
              type="button"
              className="rounded-sm border border-mid-grey px-3 py-1 text-[13px]"
              onClick={() => onOpen(transaction)}
            >
              Resolve
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

export function Transactions() {
  const [activeTransaction, setActiveTransaction] = useState<Transaction | null>(null);
  const reduceMotion = useReducedMotion();
  const [direction, setDirection] = useState<"All" | "Money out" | "Money in">("All");
  const query = useQuery({
    queryKey: ["transactions"],
    queryFn: async () => {
      const res = await apiClient.transactions.$get({ query: {} });
      if (!res.ok) throw new Error(`Failed to load transactions (${res.status})`);
      return (await res.json()) as Transaction[];
    },
  });

  useEffect(() => {
    if (query.isError) showError("Couldn't load your transactions.");
  }, [query.isError]);

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="font-body text-[20px] font-semibold">Transactions</h1>
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Transaction direction" className="flex flex-wrap gap-1">
          {(["All", "Money out", "Money in"] as const).map((label) => (
            <Button key={label} type="button" variant={direction === label ? "primary" : "secondary"}
              aria-pressed={direction === label} onClick={() => setDirection(label)} className="px-3 py-2">
              {label}
            </Button>
          ))}
        </div>
        <NavLink
          to="/statement-upload"
          className="flex items-center gap-2 rounded-sm border border-mid-grey bg-hyper-white px-4 py-2 font-body text-[15px] font-semibold text-blackberry"
        >
          <StatementUploadIcon aria-hidden="true" />
          Upload statement
        </NavLink>
        <NavLink
          to="/log-transaction"
          className="flex items-center gap-2 rounded-md bg-blackberry px-4 py-2 font-body text-[15px] font-semibold text-hyper-white"
        >
          <PlusIcon />
          Log transaction
        </NavLink>
      </div>
    </div>
  );

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <div data-testid="transactions-skeleton" className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-mid-grey" />
          ))}
        </div>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <div className="flex flex-col items-center gap-4 p-8 text-center">
          <p className="font-body text-[18px] text-text-secondary">Couldn't load your transactions.</p>
          <button
            type="button"
            className="rounded-md bg-blackberry px-6 py-3 font-body text-[15px] font-semibold text-hyper-white"
            onClick={() => query.refetch()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const transactions = query.data!;

  const filtered = transactions.filter((t) =>
    direction === "Money out" ? t.amount < 0 : direction === "Money in" ? t.amount > 0 : true
  );

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <div className="flex min-h-[55vh] items-center justify-center">
          <EmptyState
            icon={<TransactionsEmptyIllustration />}
            message={transactions.length === 0 || direction === "All"
              ? "No transactions yet."
              : direction === "Money out" ? "No outflow transactions yet." : "No inflow transactions yet."}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {header}
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 max-h-[calc(100dvh-8rem)] overflow-y-auto overscroll-contain pr-2">
          <ListReveal items={filtered.map((t) => (
            <TransactionRow key={t.id} transaction={t} onOpen={setActiveTransaction} />
          ))} />
        </div>
        <AnimatePresence>
          {activeTransaction && (
            <motion.aside
              aria-label="Transaction details"
              initial={reduceMotion ? false : { width: 0, opacity: 0 }}
              animate={{ width: 400, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.23, 1, 0.32, 1] }}
              className="shrink-0 self-start overflow-hidden"
            >
              <div className="w-[400px]">
                <TransactionDetailPanel transaction={transactions.find(row => row.id === activeTransaction.id) ?? activeTransaction} onClose={() => setActiveTransaction(null)} />
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
