import { DedupEmptyIllustration } from "../components/illustrations";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { Button, Card, EmptyState, ListReveal, showError, showSuccess } from "../components";
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
    return <EmptyState icon={<DedupEmptyIllustration />} message="No duplicates to review." />;
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
      <div className="flex items-center justify-between">
        <p className="font-body text-[18px] font-semibold">Duplicate candidates</p>
        <Button variant="primary" disabled={selected.size === 0} onClick={resolveSelected}>
          Confirm selected as distinct
        </Button>
      </div>

      <ListReveal className="contents" items={pairs.map(([a, b]) => (
        <div key={a.dedupGroupId} className="flex flex-col gap-2 rounded-xl border border-mid-grey p-3">
          <label className="flex items-center gap-2 text-[13px] text-text-secondary">
            <input
              type="checkbox"
              aria-label="select this pair"
              checked={selected.has(a.dedupGroupId!)}
              onChange={() => toggleSelected(a.dedupGroupId!)}
            />
            Select this pair
          </label>
          <div className="grid grid-cols-2 gap-3">
            {[a, b].map((t) => (
              <Card key={t.id}>
                <p className="font-body font-semibold">{displayVendor(t)}</p>
                <p className="font-body text-[13px] text-text-secondary">
                  {t.source} — {formatCents(t.amount)} — {t.date}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="rounded-sm bg-blackberry px-3 py-1 text-[13px] font-semibold text-hyper-white"
                    onClick={() => resolveMutation.mutate({ id: t.id, action: "kept" })}
                  >
                    Keep this one
                  </button>
                </div>
              </Card>
            ))}
          </div>
          <button
            type="button"
            className="self-start rounded-sm border border-mid-grey px-3 py-1 text-[13px]"
            onClick={() => resolveMutation.mutate({ id: a.id, action: "confirmed_distinct" })}
          >
            Confirm distinct
          </button>
        </div>
      ))} />
    </div>
  );
}
