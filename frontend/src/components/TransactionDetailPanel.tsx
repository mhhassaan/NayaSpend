import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { Button, Card, showError, showSuccess } from "./index";
import { CategorySelect } from "./CategorySelect";
import type { Transaction } from "../types/transaction";
import { parseRupeesToCents } from "../utils/money";

export function TransactionDetailPanel({ transaction, onClose }: { transaction: Transaction | null; onClose: () => void }) {
  return transaction ? <DetailForm key={transaction.id} transaction={transaction} onClose={onClose} /> : null;
}

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

function DetailForm({ transaction, onClose }: { transaction: Transaction; onClose: () => void }) {
  const queryClient = useQueryClient();
  const transactions = queryClient.getQueryData<Transaction[]>(["transactions"]) ?? [];
  const extraCategories = [...transactions.map(row => row.category), transaction.category];
  const [vendorRaw, setVendorRaw] = useState(transaction.vendorRaw);
  const [amount, setAmount] = useState(String(Math.abs(transaction.amount) / 100));
  const [direction, setDirection] = useState<"Money out" | "Money in">(transaction.amount > 0 ? "Money in" : "Money out");
  const [date, setDate] = useState(transaction.date);
  const [category, setCategory] = useState(transaction.category);
  const [clientError, setClientError] = useState<string | null>(null);
  const provenance = parseProvenance(transaction.provenance);

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
      onClose();
    },
    onError: () => showError("Couldn't update the category."),
  });

  // A quarantined row starts as a zero-amount placeholder (buildQuarantinedRow
  // in the adapters) -- committing it unedited would write junk into the
  // ledger, so Commit saves the edited fields first and only resolves if
  // that succeeds. Validate a positive magnitude before either request fires.
  const commitMutation = useMutation({
    mutationFn: async () => {
      const magnitude = Math.abs(parseRupeesToCents(amount));
      const amountCents = direction === "Money out" ? -magnitude : magnitude;
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
    const magnitude = Math.abs(parseRupeesToCents(amount));
    if (!Number.isFinite(magnitude) || magnitude <= 0) {
      setClientError("Enter an amount greater than zero before this can be committed.");
      return;
    }
    setClientError(null);
    commitMutation.mutate();
  }

  return (
    <Card className="h-full max-h-[calc(100dvh-8rem)] overflow-y-auto overscroll-contain pr-2">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="font-semibold">Transaction details</h2>
        <Button type="button" variant="secondary" aria-label="Close transaction details" onClick={onClose}>Close</Button>
      </div>
      {transaction.reviewStatus === "committed" ? (
        <div className="flex flex-col gap-3">
          <CategorySelect aria-label="Category" value={category} onChange={setCategory} extraCategories={extraCategories} />
          <Button type="button" onClick={() => mutation.mutate(category)}>Save</Button>
        </div>
      ) : (
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
              aria-label="Vendor" placeholder="e.g. Corner Store"
              className="rounded-sm border border-mid-grey px-3 py-2"
              value={vendorRaw}
              onChange={(e) => setVendorRaw(e.target.value)}
            />
          </label>
          <div role="group" aria-label="Transaction direction" className="flex flex-wrap gap-1">
            {(["Money out", "Money in"] as const).map((label) => (
              <Button key={label} type="button" variant={direction === label ? "primary" : "secondary"}
                aria-pressed={direction === label} onClick={() => setDirection(label)} className="px-3 py-2">
                {label}
              </Button>
            ))}
          </div>
          <label className="flex flex-col gap-1">
            <span className="font-body text-[13px] font-semibold text-text-secondary">Amount (Rs.)</span>
            <input
              aria-label="Amount" placeholder="e.g. 1250.00"
              className="rounded-sm border border-mid-grey px-3 py-2"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/-/g, ""))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-body text-[13px] font-semibold text-text-secondary">Date</span>
            <input aria-label="Date" placeholder="YYYY-MM-DD" className="rounded-sm border border-mid-grey px-3 py-2" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-body text-[13px] font-semibold text-text-secondary">Category</span>
            <CategorySelect aria-label="Category" value={category} onChange={setCategory} extraCategories={extraCategories} />
          </label>
          {clientError && <p className="font-body text-[13px] text-danger">{clientError}</p>}
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={handleCommit}
            >
              Commit
            </Button>
            <Button
              variant="danger" type="button"
              onClick={() => rejectMutation.mutate()}
            >
              Reject
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

