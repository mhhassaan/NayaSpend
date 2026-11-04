import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { Card, EmptyState, Modal, Pill, showError, showSuccess } from "../components";
import type { Transaction } from "../types/transaction";

function formatCents(cents: number): string {
  return `Rs. ${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function CategoryEditor({ transaction, onDone }: { transaction: Transaction; onDone: () => void }) {
  const [value, setValue] = useState(transaction.category);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (category: string) => {
      // Backend routes validate the JSON body manually (no Hono zValidator
      // middleware), so hc<AppType>() can't infer a `json` input shape for
      // this call -- passing the args via a variable (not an inline
      // literal) avoids TS's excess-property check on the literal while
      // keeping `param`'s own type checked.
      const args = { param: { id: String(transaction.id) }, json: { category } };
      const res = await apiClient.transactions[":id"].category.$patch(args);
      if (!res.ok) throw new Error(`Failed to update category (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      showSuccess("Category updated");
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      onDone();
    },
    onError: () => showError("Couldn't update the category."),
  });

  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor={`category-${transaction.id}`}>
        Category
      </label>
      <input
        id={`category-${transaction.id}`}
        role="textbox"
        aria-label="Category"
        className="rounded-sm border border-mid-grey px-2 py-1 text-[13px]"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        type="button"
        className="rounded-sm bg-blackberry px-3 py-1 text-[13px] font-semibold text-hyper-white"
        onClick={() => mutation.mutate(value)}
      >
        Save
      </button>
    </div>
  );
}

function ResolveReviewModal({ transaction, open, onClose }: { transaction: Transaction; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (action: "commit" | "reject") => {
      const args = { param: { id: String(transaction.id) }, json: { action } };
      const res = await apiClient.transactions[":id"]["resolve-review"].$post(args);
      if (!res.ok) throw new Error(`Failed to resolve review (${res.status})`);
      return (await res.json()) as { resolved: string; matched: boolean };
    },
    onSuccess: (data) => {
      if (data.resolved === "commit" && data.matched) {
        showSuccess("Committed — this matched a possible duplicate, check Dedup Review");
      } else {
        showSuccess(data.resolved === "commit" ? "Committed" : "Rejected");
      }
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      onClose();
    },
    onError: () => showError("Couldn't resolve this transaction."),
  });

  return (
    <Modal open={open} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="font-body text-[15px]">
          {transaction.vendorRaw} — {formatCents(transaction.amount)}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-sm bg-blackberry px-4 py-2 text-[13px] font-semibold text-hyper-white"
            onClick={() => mutation.mutate("commit")}
          >
            Commit
          </button>
          <button
            type="button"
            className="rounded-sm bg-hot-red px-4 py-2 text-[13px] font-semibold text-hyper-white"
            onClick={() => mutation.mutate("reject")}
          >
            Reject
          </button>
        </div>
      </div>
    </Modal>
  );
}

function TransactionRow({ transaction }: { transaction: Transaction }) {
  const [editing, setEditing] = useState(false);
  const [resolving, setResolving] = useState(false);

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <span className="font-body font-semibold">{transaction.vendorRaw}</span>
          {editing ? (
            <CategoryEditor transaction={transaction} onDone={() => setEditing(false)} />
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="text-left">
              <Pill>{transaction.category}</Pill>
            </button>
          )}
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
              onClick={() => setResolving(true)}
            >
              Resolve
            </button>
          )}
        </div>
      </div>
      <ResolveReviewModal transaction={transaction} open={resolving} onClose={() => setResolving(false)} />
    </Card>
  );
}

export function Transactions() {
  const query = useQuery({
    queryKey: ["transactions"],
    queryFn: async () => {
      const res = await apiClient.transactions.$get({ query: {} });
      if (!res.ok) throw new Error(`Failed to load transactions (${res.status})`);
      return (await res.json()) as Transaction[];
    },
  });

  if (query.isPending) {
    return (
      <div data-testid="transactions-skeleton" className="flex flex-col gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-mid-grey" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
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
    );
  }

  const transactions = query.data!;

  if (transactions.length === 0) {
    return <EmptyState message="No transactions yet." />;
  }

  return (
    <div className="flex flex-col gap-3">
      {transactions.map((t) => (
        <TransactionRow key={t.id} transaction={t} />
      ))}
    </div>
  );
}
