import { BudgetsEmptyIllustration } from "../components/illustrations";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { Button, Card, EmptyState, ListReveal, Modal, StatDisplay, showError, showSuccess } from "../components";
import type { Budget } from "../types/transaction";
import { formatCents, parseRupeesToCents } from "../utils/money";

type MonthlyTrends = {
  month: string;
  spentCents: number;
  receivedCents: number;
  byCategory: { category: string; totalCents: number }[];
  hasData: boolean;
};

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function spentFor(category: string, trends: MonthlyTrends): number {
  return trends.byCategory.find((c) => c.category === category)?.totalCents ?? 0;
}

function CreateBudgetForm({ onDone }: { onDone: () => void }) {
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const limitAmount = parseRupeesToCents(limit);
      const args = { json: { category, limitAmount, periodType: "monthly" as const } };
      const res = await apiClient.budgets.$post(args);
      if (!res.ok) throw new Error((await res.text()) || `Failed to create budget (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      showSuccess("Budget created");
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      onDone();
    },
    onError: (err: Error) => {
      setClientError(err.message);
      showError("Couldn't create that budget.");
    },
  });

  function handleSave() {
    const limitAmount = parseRupeesToCents(limit);
    // Mirrors the backend's own validation message (budgets.ts) so the
    // inline error reads the same whether it came from this client-side
    // check or a server rejection.
    if (!Number.isInteger(limitAmount) || limitAmount <= 0) {
      setClientError("limitAmount must be a positive integer");
      return;
    }
    setClientError(null);
    mutation.mutate();
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="font-body text-[13px] font-semibold text-text-secondary">Category</span>
        <input
          aria-label="Category"
          className="rounded-sm border border-mid-grey px-3 py-2"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-body text-[13px] font-semibold text-text-secondary">Limit (Rs.)</span>
        <input
          aria-label="Limit"
          type="text"
          inputMode="numeric"
          className="rounded-sm border border-mid-grey px-3 py-2"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
        />
      </label>
      {clientError && <p className="font-body text-[13px] text-danger">{clientError}</p>}
      <Button variant="primary" onClick={handleSave}>
        Save
      </Button>
    </div>
  );
}

function LimitEditor({ budget, onDone }: { budget: Budget; onDone: () => void }) {
  const [value, setValue] = useState(String(budget.limitAmount / 100));
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const limitAmount = parseRupeesToCents(value);
      const args = { param: { id: String(budget.id) }, json: { limitAmount } };
      const res = await apiClient.budgets[":id"].$patch(args);
      if (!res.ok) throw new Error((await res.text()) || `Failed to update budget (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      showSuccess("Budget updated");
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      onDone();
    },
    onError: () => showError("Couldn't update that budget."),
  });

  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor={`limit-${budget.id}`}>
        {`Edit limit for ${budget.category}`}
      </label>
      <input
        id={`limit-${budget.id}`}
        aria-label={`Edit limit for ${budget.category}`}
        className="rounded-sm border border-mid-grey px-2 py-1 text-[13px]"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        type="button"
        className="rounded-sm bg-blackberry px-3 py-1 text-[13px] font-semibold text-hyper-white"
        onClick={() => mutation.mutate()}
      >
        Save
      </button>
    </div>
  );
}

function BudgetRow({ budget, trends }: { budget: Budget; trends: MonthlyTrends }) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const queryClient = useQueryClient();

  const spent = spentFor(budget.category, trends);
  const pct = budget.limitAmount > 0 ? Math.round((spent / budget.limitAmount) * 100) : 0;

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const args = { param: { id: String(budget.id) } };
      const res = await apiClient.budgets[":id"].$delete(args);
      if (!res.ok) throw new Error(`Failed to delete budget (${res.status})`);
    },
    onSuccess: () => {
      showSuccess("Budget deleted");
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      setConfirmingDelete(false);
    },
    onError: () => showError("Couldn't delete that budget."),
  });

  return (
    <Card>
      <div className="flex items-center justify-between">
        {editing ? (
          <LimitEditor budget={budget} onDone={() => setEditing(false)} />
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="text-left">
            <StatDisplay
              label={budget.category}
              value={`${formatCents(spent)} / ${formatCents(budget.limitAmount)}`}
              trailingIcon={<span className="font-body text-[15px] font-semibold">{pct}%</span>}
            />
          </button>
        )}
        <button
          type="button"
          className="rounded-sm border border-mid-grey px-3 py-1 text-[13px]"
          onClick={() => setConfirmingDelete(true)}
        >
          Delete
        </button>
      </div>
      <Modal open={confirmingDelete} onClose={() => setConfirmingDelete(false)}>
        <div className="flex flex-col gap-4">
          <p className="font-body text-[15px]">Delete the {budget.category} budget?</p>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-sm bg-hot-red px-4 py-2 text-[13px] font-semibold text-hyper-white"
              onClick={() => deleteMutation.mutate()}
            >
              Confirm
            </button>
            <button
              type="button"
              className="rounded-sm border border-mid-grey px-4 py-2 text-[13px]"
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

export function Budgets() {
  const [creating, setCreating] = useState(false);
  const month = currentMonth();

  const budgetsQuery = useQuery({
    queryKey: ["budgets"],
    queryFn: async () => {
      const res = await apiClient.budgets.$get();
      if (!res.ok) throw new Error(`Failed to load budgets (${res.status})`);
      return (await res.json()) as Budget[];
    },
  });

  const trendsQuery = useQuery({
    queryKey: ["trends", month],
    queryFn: async () => {
      const res = await apiClient.trends.$get({ query: { month } });
      if (!res.ok) throw new Error(`Failed to load trends (${res.status})`);
      return (await res.json()) as MonthlyTrends;
    },
  });

  useEffect(() => {
    if (budgetsQuery.isError) showError("Couldn't load your budgets.");
  }, [budgetsQuery.isError]);

  useEffect(() => {
    if (trendsQuery.isError) showError("Couldn't load this month's spending.");
  }, [trendsQuery.isError]);

  if (budgetsQuery.isPending || trendsQuery.isPending) {
    return (
      <div data-testid="budgets-skeleton" className="flex flex-col gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-mid-grey" />
        ))}
      </div>
    );
  }

  if (budgetsQuery.isError || trendsQuery.isError) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p className="font-body text-[18px] text-text-secondary">Couldn't load your budgets.</p>
        <button
          type="button"
          className="rounded-md bg-blackberry px-6 py-3 font-body text-[15px] font-semibold text-hyper-white"
          onClick={() => {
            budgetsQuery.refetch();
            trendsQuery.refetch();
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  const budgetsList = budgetsQuery.data!;
  const trends = trendsQuery.data!;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-body text-[20px] font-semibold">Budgets</h1>
        <Button variant="primary" onClick={() => setCreating(true)}>
          Create budget
        </Button>
      </div>

      {creating && (
        <Card>
          <CreateBudgetForm onDone={() => setCreating(false)} />
        </Card>
      )}

      {budgetsList.length === 0 ? (
        <EmptyState icon={<BudgetsEmptyIllustration />} message="No budgets yet." />
      ) : (
        <ListReveal items={budgetsList.map((b) => (
            <BudgetRow key={b.id} budget={b} trends={trends} />
          ))} />
      )}
    </div>
  );
}
