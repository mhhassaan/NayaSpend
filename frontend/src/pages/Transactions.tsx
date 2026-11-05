import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { StatementUploadIcon } from "../components/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { Card, EmptyState, Modal, Pill, showError, showSuccess } from "../components";
import type { Transaction } from "../types/transaction";
import { formatCents, parseRupeesToCents } from "../utils/money";
import { maskAccountNumbers } from "../utils/mask";

// Quarantined rows carry the adapter's own context for why they were held
// back (gmailAdapter.ts/statementAdapter.ts's buildQuarantinedRow) -- shown
// so the person resolving a row has something to correct it from.
type Provenance = { quarantineReason?: string; subject?: string; bodyExcerpt?: string; fileRef?: string; rowIndex?: number };

function parseProvenance(raw: string): Provenance | null {
  try {
    return JSON.parse(raw) as Provenance;
  } catch {
    return null;
  }
}

// A statement-sourced vendorRaw is the statement's own Description column,
// which can carry an account number or IBAN verbatim -- mask it here
// (and everywhere outside the upload's own flow), never on the page the
// user views right after uploading.
function displayVendor(transaction: Transaction): string {
  return transaction.source === "statement_import" ? maskAccountNumbers(transaction.vendorRaw) : transaction.vendorRaw;
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
  const [vendorRaw, setVendorRaw] = useState(transaction.vendorRaw);
  const [amount, setAmount] = useState(String(transaction.amount / 100));
  const [date, setDate] = useState(transaction.date);
  const [category, setCategory] = useState(transaction.category);
  const [clientError, setClientError] = useState<string | null>(null);
  const provenance = parseProvenance(transaction.provenance);

  // A quarantined row starts as a zero-amount placeholder (buildQuarantinedRow
  // in the adapters) -- committing it unedited would write junk into the
  // ledger, so Commit saves the edited fields first and only resolves if
  // that succeeds. The backend's own resolve-review guard (amount > 0) is
  // mirrored here so the user sees the problem before either request fires.
  const commitMutation = useMutation({
    mutationFn: async () => {
      const amountCents = parseRupeesToCents(amount);
      const patchArgs = { param: { id: String(transaction.id) }, json: { vendorRaw, amount: amountCents, date, category } };
      const patchRes = await apiClient.transactions[":id"].$patch(patchArgs);
      if (!patchRes.ok) throw new Error((await patchRes.text()) || `Failed to save changes (${patchRes.status})`);
      const resolveArgs = { param: { id: String(transaction.id) }, json: { action: "commit" as const } };
      const res = await apiClient.transactions[":id"]["resolve-review"].$post(resolveArgs);
      if (!res.ok) throw new Error(`Failed to resolve review (${res.status})`);
      return (await res.json()) as { resolved: string; matched: boolean };
    },
    onSuccess: (data) => {
      showSuccess(data.matched ? "Committed — this matched a possible duplicate, check Dedup Review" : "Committed");
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      onClose();
    },
    onError: (err: Error) => {
      setClientError(err.message);
      showError("Couldn't resolve this transaction.");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const args = { param: { id: String(transaction.id) }, json: { action: "reject" as const } };
      const res = await apiClient.transactions[":id"]["resolve-review"].$post(args);
      if (!res.ok) throw new Error(`Failed to resolve review (${res.status})`);
      return (await res.json()) as { resolved: string; matched: boolean };
    },
    onSuccess: () => {
      showSuccess("Rejected");
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      onClose();
    },
    onError: () => showError("Couldn't resolve this transaction."),
  });

  function handleCommit() {
    const amountCents = parseRupeesToCents(amount);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setClientError("amount must be a positive integer before this row can be committed");
      return;
    }
    setClientError(null);
    commitMutation.mutate();
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {provenance && (provenance.quarantineReason || provenance.subject || provenance.bodyExcerpt || provenance.fileRef) && (
          <div className="rounded-sm bg-silver-frost p-3 font-body text-[13px] text-text-secondary">
            {provenance.quarantineReason && <p className="font-semibold">{provenance.quarantineReason}</p>}
            {provenance.subject && <p>{provenance.subject}</p>}
            {provenance.bodyExcerpt && <p>{provenance.bodyExcerpt}</p>}
            {provenance.fileRef && (
              <p>
                {provenance.fileRef} (row {provenance.rowIndex})
              </p>
            )}
          </div>
        )}
        <label className="flex flex-col gap-1">
          <span className="font-body text-[13px] font-semibold text-text-secondary">Vendor</span>
          <input
            aria-label="Vendor"
            className="rounded-sm border border-mid-grey px-3 py-2"
            value={vendorRaw}
            onChange={(e) => setVendorRaw(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-body text-[13px] font-semibold text-text-secondary">Amount (Rs.)</span>
          <input
            aria-label="Amount"
            className="rounded-sm border border-mid-grey px-3 py-2"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-body text-[13px] font-semibold text-text-secondary">Date</span>
          <input aria-label="Date" className="rounded-sm border border-mid-grey px-3 py-2" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-body text-[13px] font-semibold text-text-secondary">Category</span>
          <input
            aria-label="Category"
            className="rounded-sm border border-mid-grey px-3 py-2"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </label>
        {clientError && <p className="font-body text-[13px] text-danger">{clientError}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-sm bg-blackberry px-4 py-2 text-[13px] font-semibold text-hyper-white"
            onClick={handleCommit}
          >
            Commit
          </button>
          <button
            type="button"
            className="rounded-sm bg-hot-red px-4 py-2 text-[13px] font-semibold text-hyper-white"
            onClick={() => rejectMutation.mutate()}
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
          <span className="font-body font-semibold">{displayVendor(transaction)}</span>
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

  useEffect(() => {
    if (query.isError) showError("Couldn't load your transactions.");
  }, [query.isError]);

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="font-body text-[20px] font-semibold">Transactions</h1>
      <NavLink
        to="/statement-upload"
        className="flex items-center gap-2 rounded-sm border border-mid-grey bg-hyper-white px-4 py-2 font-body text-[15px] font-semibold text-blackberry"
      >
        <StatementUploadIcon aria-hidden="true" />
        Upload statement
      </NavLink>
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

  if (transactions.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <EmptyState message="No transactions yet." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {header}
      <div className="flex flex-col gap-3">
        {transactions.map((t) => (
          <TransactionRow key={t.id} transaction={t} />
        ))}
      </div>
    </div>
  );
}
