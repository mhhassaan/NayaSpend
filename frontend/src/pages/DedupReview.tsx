import { DedupEmptyIllustration } from "../components/illustrations";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { Button, Card, EmptyState, Pill, showError, showSuccess } from "../components";
import type { Transaction } from "../types/transaction";
import { formatCents } from "../utils/money";
import { maskAccountNumbers } from "../utils/mask";

function displayVendor(transaction: Transaction): string {
  return transaction.source === "statement_import" ? maskAccountNumbers(transaction.vendorRaw) : transaction.vendorRaw;
}

type DedupAction = "kept" | "discarded" | "confirmed_distinct";

function groupPairs(transactions: Transaction[]): [Transaction, Transaction][] {
  const byGroup = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.dedupResolution !== "pending" || !t.dedupGroupId) continue;
    const list = byGroup.get(t.dedupGroupId) ?? [];
    list.push(t);
    byGroup.set(t.dedupGroupId, list);
  }
  const pairs: [Transaction, Transaction][] = [];
  for (const list of byGroup.values()) {
    if (list.length === 2) pairs.push([list[0], list[1]]);
  }
  return pairs;
}

export function DedupReview() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ["transactions"],
    queryFn: async () => {
      const res = await apiClient.transactions.$get({ query: {} });
      if (!res.ok) throw new Error(`Failed to load transactions (${res.status})`);
      return (await res.json()) as Transaction[];
    },
  });

  async function resolveDedupPair(id: number, action: DedupAction) {
    const args = { param: { id: String(id) }, json: { action } };
    const res = await apiClient.transactions[":id"]["resolve-dedup"].$post(args);
    if (!res.ok) throw new Error(`Failed to resolve dedup pair (${res.status})`);
    return res.json();
  }

  const resolveMutation = useMutation({
    mutationFn: ({ id, action }: { id: number; action: DedupAction }) => resolveDedupPair(id, action),
    onSuccess: () => {
      showSuccess("Resolved");
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: () => showError("Couldn't resolve this pair."),
  });

  useEffect(() => {
    if (query.isError) showError("Couldn't load duplicate candidates.");
  }, [query.isError]);

  if (query.isPending) {
    return (
      <div data-testid="dedup-review-skeleton" className="flex flex-col gap-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-mid-grey" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p className="font-body text-[18px] text-text-secondary">Couldn't load duplicate candidates.</p>
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

  const pairs = groupPairs(query.data!);

  if (pairs.length === 0) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center">
        <EmptyState icon={<DedupEmptyIllustration />} message="No duplicates to review." />
      </div>
    );
  }

  function toggleSelected(groupId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  // Bulk-resolving is limited to "confirmed_distinct" -- "kept" discards
  // the *other* side of the pair, and there is no per-pair UI here to say
  // which side that should be, so applying it in bulk would soft-delete an
  // arbitrary row (whichever the API happened to list first). Marking a
  // batch as distinct is the one action safe to apply without that choice.
  async function resolveSelected() {
    let succeeded = 0;
    let failed = 0;
    for (const groupId of selected) {
      const pair = pairs.find(([a]) => a.dedupGroupId === groupId);
      if (!pair) continue;
      try {
        await resolveDedupPair(pair[0].id, "confirmed_distinct");
        succeeded++;
      } catch {
        failed++;
      }
    }
    setSelected(new Set());
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    if (failed === 0) {
      showSuccess(`Confirmed ${succeeded} pair${succeeded === 1 ? "" : "s"} as distinct`);
    } else {
      showError(`Confirmed ${succeeded} pair${succeeded === 1 ? "" : "s"}, ${failed} failed`);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-[20px] font-semibold">Duplicate candidates</h1>
          <p className="mt-2 text-sm text-text-secondary">Compare the details, then choose what to keep.</p>
        </div>
        <Pill>{pairs.length} {pairs.length === 1 ? "pair" : "pairs"} waiting</Pill>
      </div>
      <Card className="flex flex-col gap-4 border border-border !bg-silver-frost sm:flex-row sm:items-center sm:justify-between">
        <div>
          {selected.size > 0 && <p className="font-semibold" aria-live="polite">{selected.size} {selected.size === 1 ? "pair" : "pairs"} selected</p>}
          <p className="text-sm text-text-secondary">Confirming distinct keeps both entries in every selected pair.</p>
        </div>
        <Button variant="primary" disabled={selected.size === 0} onClick={resolveSelected}>
          Confirm selected as distinct
        </Button>
      </Card>

      {pairs.map(([a, b]) => (
        <Card key={a.dedupGroupId} className="overflow-hidden border border-border !p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-silver-frost p-4">
          <label className="flex items-center gap-2 text-[13px] text-text-secondary">
            <input
              type="checkbox"
              aria-label="select this pair"
              checked={selected.has(a.dedupGroupId!)}
              onChange={() => toggleSelected(a.dedupGroupId!)}
            />
            Select this pair
          </label>
          <p className="text-xs text-text-secondary">Possible duplicate / 2 entries</p>
          </div>
          <div className="p-4">
            <div className="mb-4 flex flex-wrap gap-2" aria-label="Transaction comparison">
              {([ ["amount", "amount"], ["date", "date"], ["source", "source"], ["vendorRaw", "vendor string"] ] as const).map(([field, label]) => (
                <Pill key={field} tone={a[field] === b[field] ? "neutral" : "warning"}>
                  {a[field] === b[field] ? "Same" : "Different"} {label}
                </Pill>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[a, b].map((t, i) => (
                <Card key={t.id} className="min-w-0 border border-border">
                  <p className="text-xs font-semibold text-text-secondary">ENTRY {i === 0 ? "A" : "B"}</p>
                  <h2 className="mt-2 break-words font-body font-semibold">{displayVendor(t)}</h2>
                  <p className="mt-4 text-3xl font-bold tabular-nums">{formatCents(t.amount)}</p>
                  <dl className="my-4 flex flex-col gap-2 text-sm">
                    <div className="flex flex-wrap gap-3"><dt className="text-text-secondary">Date</dt><dd>{t.date}</dd></div>
                    <div className="flex flex-wrap gap-3"><dt className="text-text-secondary">Source</dt><dd className="break-words">{t.source}</dd></div>
                  </dl>
                  <Button type="button" className="w-full active:transform-none" aria-describedby={`keep-${t.id}`}
                    onClick={() => resolveMutation.mutate({ id: t.id, action: "kept" })}>
                    Keep this one
                  </Button>
                  <p id={`keep-${t.id}`} className="mt-2 text-center text-xs text-text-secondary">Keeps entry {i === 0 ? "A" : "B"} and discards entry {i === 0 ? "B" : "A"}.</p>
                </Card>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-4 bg-light-purple p-4 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="font-semibold">Two separate purchases</p>
            <p id={`distinct-${a.id}`} className="text-sm text-text-secondary">Keeps both entries and clears this duplicate flag.</p></div>
            <Button type="button" variant="secondary" className="active:transform-none" aria-describedby={`distinct-${a.id}`}
              onClick={() => resolveMutation.mutate({ id: a.id, action: "confirmed_distinct" })}>
              Confirm distinct
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
