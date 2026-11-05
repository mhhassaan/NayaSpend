import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { Card, EmptyState, Pill, StatDisplay, Tile, showError } from "../components";
import { BillsIcon, BudgetsIcon, StatementUploadIcon, TransactionsIcon } from "../components/icons";

import { formatCents } from "../utils/money";
import type { Budget } from "../types/transaction";

type MonthlyTrends = {
  month: string;
  spentCents: number;
  receivedCents: number;
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

  const budgetsQuery = useQuery({
    queryKey: ["budgets"],
    queryFn: async () => {
      const res = await apiClient.budgets.$get();
      if (!res.ok) throw new Error(`Failed to load budgets (${res.status})`);
      return (await res.json()) as Budget[];
    },
    retry: false,
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
  const maxHistoryTotal = Math.max(1, ...historyData.months.map((m) => m.spentCents));

  const selectedHistory = historyData.months.find((entry) => entry.month === month);
  const previousMonth = shiftMonth(month, -1);
  const previousHistory = historyData.months.find((entry) => entry.month === previousMonth);
  const delta = monthData.hasData && selectedHistory && previousHistory && previousHistory.spentCents > 0
    && selectedHistory.spentCents !== previousHistory.spentCents
    ? ((selectedHistory.spentCents - previousHistory.spentCents) / previousHistory.spentCents) * 100
    : null;
  const previousMonthName = new Date(`${previousMonth}-01T00:00:00Z`).toLocaleString("en", { month: "short", timeZone: "UTC" });
  const [year, monthNumber] = month.split("-").map(Number);
  const days = month === currentMonth()
    ? new Date().getUTCDate()
    : new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const categories = [...monthData.byCategory].sort((a, b) => b.totalCents - a.totalCents);
  const monthlySpentCents = monthData.spentCents;

  return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end gap-6">
          <div className="flex flex-wrap items-center gap-3">
            <StatDisplay label={`Spend for ${monthData.month}`} value={formatCents(monthlySpentCents)} />
            {delta !== null && (
              <Pill tone={delta > 0 ? "warning" : "success"}>
                {`${delta > 0 ? "\u25b2" : "\u25bc"} ${Math.max(1, Math.round(Math.abs(delta)))}% vs ${previousMonthName}`}
              </Pill>
            )}
          </div>
          {monthData.hasData && monthlySpentCents > 0 && (
            <StatDisplay label="Avg/day" value={formatCents(monthlySpentCents / days)} />
          )}
          {monthData.receivedCents > 0 && (
            <StatDisplay label="Received" value={formatCents(monthData.receivedCents)} />
          )}
        </div>

        <div className="grid grid-cols-4 gap-3">
          <Tile icon={<TransactionsIcon />} label="Log transaction" onClick={() => (window.location.href = "/log-transaction")} />
          <Tile icon={<StatementUploadIcon />} label="Upload statement" onClick={() => (window.location.href = "/statement-upload")} />
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
              {categories.map((c) => {
                const share = monthlySpentCents > 0 ? Math.max(0, Math.min(100, (c.totalCents / monthlySpentCents) * 100)) : 0;
                return (
                  <div key={c.category} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <Pill>{c.category}</Pill>
                      <span className="font-body text-[15px] font-semibold">{formatCents(c.totalCents)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-xl bg-mid-grey">
                      <div
                        role="meter"
                        aria-label={`${c.category} share of spending`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={share}
                        className="h-full rounded-xl bg-accent"
                        style={{ width: `${share}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {budgetsQuery.isSuccess && budgetsQuery.data.length > 0 && (
          <Card>
            <section aria-label="Budgets at a glance" className="flex flex-col gap-3">
              <h2 className="font-body text-[15px] font-semibold text-text-secondary">Budgets at a glance</h2>
              {budgetsQuery.data.map((budget) => {
                const spent = monthData.byCategory.find((c) => c.category === budget.category)?.totalCents ?? 0;
                const pct = budget.limitAmount > 0 ? Math.round((spent / budget.limitAmount) * 100) : 0;
                return (
                  <div key={budget.id} className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-body text-[15px]">
                      <p className="font-semibold">{budget.category}</p>
                      <p className="text-text-secondary">{formatCents(spent)} / {formatCents(budget.limitAmount)}</p>
                    </div>
                    <Pill tone={pct >= 100 ? "danger" : pct >= 80 ? "warning" : "neutral"}>{pct}%</Pill>
                  </div>
                );
              })}
            </section>
          </Card>
        )}

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
                    style={{ height: `${Math.max(2, (m.spentCents / maxHistoryTotal) * 100)}px` }}
                  />
                  <span className="font-body text-[11px] text-text-secondary">{m.month.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
  );
}
