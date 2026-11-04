import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { apiClient } from "../api/client";
import { Card, EmptyState, Pill, StatDisplay, Tile, showError } from "../components";
import { BillsIcon, BudgetsIcon, TransactionsIcon } from "../components/icons";

type MonthlyTrends = {
  month: string;
  totalCents: number;
  byCategory: { category: string; totalCents: number }[];
  hasData: boolean;
};

type TrendsHistory = { months: MonthlyTrends[] };

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, m - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatCents(cents: number): string {
  return `Rs. ${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// This task's pattern, referenced (not repeated) by every later page task:
// a useQuery per data need; skeleton while isPending; an error block with
// Retry + a one-time showError toast on isError; EmptyState when the
// result has no data; otherwise the real content, fading in (respecting
// prefers-reduced-motion).
function FadeIn({ children }: { children: React.ReactNode }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.2 }}
    >
      {children}
    </motion.div>
  );
}

export function Dashboard() {
  const [month, setMonth] = useState(currentMonth());

  const monthQuery = useQuery({
    queryKey: ["trends", month],
    queryFn: async () => {
      const res = await apiClient.trends.$get({ query: { month } });
      if (!res.ok) throw new Error(`Failed to load trends (${res.status})`);
      return (await res.json()) as MonthlyTrends;
    },
  });

  const historyQuery = useQuery({
    queryKey: ["trends-history"],
    queryFn: async () => {
      const res = await apiClient.trends.history.$get({ query: { months: "6" } });
      if (!res.ok) throw new Error(`Failed to load trends history (${res.status})`);
      return (await res.json()) as TrendsHistory;
    },
  });

  useEffect(() => {
    if (monthQuery.isError) showError("Couldn't load this month's spending.");
  }, [monthQuery.isError]);

  useEffect(() => {
    if (historyQuery.isError) showError("Couldn't load the spending trend chart.");
  }, [historyQuery.isError]);

  if (monthQuery.isPending || historyQuery.isPending) {
    return (
      <div data-testid="dashboard-skeleton" className="flex flex-col gap-4">
        <div className="h-16 w-48 animate-pulse rounded-lg bg-mid-grey" />
        <div className="h-40 animate-pulse rounded-xl bg-mid-grey" />
      </div>
    );
  }

  if (monthQuery.isError || historyQuery.isError) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p className="font-body text-[18px] text-text-secondary">Something went wrong loading your spending.</p>
        <button
          type="button"
          className="rounded-md bg-blackberry px-6 py-3 font-body text-[15px] font-semibold text-hyper-white"
          onClick={() => {
            monthQuery.refetch();
            historyQuery.refetch();
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  const monthData = monthQuery.data!;
  const historyData = historyQuery.data!;
  const maxHistoryTotal = Math.max(1, ...historyData.months.map((m) => m.totalCents));

  return (
    <FadeIn>
      <div className="flex flex-col gap-6">
        <StatDisplay label={`Spend for ${monthData.month}`} value={formatCents(monthData.totalCents)} />

        <div className="grid grid-cols-3 gap-3">
          <Tile icon={<TransactionsIcon />} label="Log transaction" onClick={() => (window.location.href = "/log-transaction")} />
          <Tile icon={<BudgetsIcon />} label="Budgets" onClick={() => (window.location.href = "/budgets")} />
          <Tile icon={<BillsIcon />} label="Bills" onClick={() => (window.location.href = "/bills")} />
        </div>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <button type="button" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
              &larr;
            </button>
            <span className="font-body font-semibold">{monthData.month}</span>
            <button type="button" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
              &rarr;
            </button>
          </div>

          {!monthData.hasData ? (
            <EmptyState message="No spending recorded yet for this month." />
          ) : (
            <div className="flex flex-col gap-2">
              {monthData.byCategory.map((c) => (
                <div key={c.category} className="flex items-center justify-between">
                  <Pill>{c.category}</Pill>
                  <span className="font-body text-[15px] font-semibold">{formatCents(c.totalCents)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <p className="mb-3 font-body text-[15px] font-semibold text-text-secondary">Last 6 months</p>
          {historyData.months.every((m) => !m.hasData) ? (
            <EmptyState message="No statement imported for this account yet." />
          ) : (
            <div data-testid="trends-history-chart" className="flex items-end gap-2" style={{ height: 120 }}>
              {historyData.months.map((m) => (
                <div key={m.month} className="flex flex-1 flex-col items-center gap-1" title={m.month}>
                  <div
                    className="w-full rounded-t-sm bg-accent"
                    style={{ height: `${Math.max(2, (m.totalCents / maxHistoryTotal) * 100)}px` }}
                  />
                  <span className="font-body text-[11px] text-text-secondary">{m.month.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </FadeIn>
  );
}
