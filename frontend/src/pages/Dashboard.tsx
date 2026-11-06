import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { apiClient } from "../api/client";
import { Button, Card, EmptyState, Pill, StatDisplay, Tile, showError } from "../components";
import { ShareRecapModal } from "../components/ShareRecapModal";
import { BillsIcon, BudgetsIcon, StatementUploadIcon, TransactionsIcon } from "../components/icons";
import { HeroIllustration, MonthEmptyIllustration, HistoryEmptyIllustration } from "../components/illustrations";

import { formatCents } from "../utils/money";
import type { Budget } from "../types/transaction";

type MonthlyTrends = {
  month: string;
  spentCents: number;
  receivedCents: number;
  byCategory: { category: string; totalCents: number }[];
  hasData: boolean;
  biggestPurchase: { vendorRaw: string; amountCents: number } | null;
};

type TrendsHistory = { months: Omit<MonthlyTrends, "biggestPurchase">[] };

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
  const [shareOpen, setShareOpen] = useState(false);
  const reduceMotion = useReducedMotion();

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
  const everUsed = historyData.months.some((m) => m.hasData);
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
  const net = monthData.receivedCents - monthlySpentCents;

  return (
      <div className="flex flex-col gap-6">
        {!everUsed && !monthData.hasData ? (
          <Card>
            <section className="flex flex-col items-center gap-4 p-4 text-center">
              <HeroIllustration />
              <h1 className="font-body text-[20px] font-semibold">Welcome — let's get your spending in</h1>
              <div className="flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-md bg-blackberry px-4 py-2 font-body text-[15px] font-semibold text-hyper-white"
                  onClick={() => (window.location.href = "/statement-upload")}
                >
                  Upload statement
                </button>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-sm border border-mid-grey bg-hyper-white px-4 py-2 font-body text-[15px] font-semibold text-blackberry"
                  onClick={() => (window.location.href = "/log-transaction")}
                >
                  Log a transaction
                </button>
              </div>
            </section>
          </Card>
        ) : (
          <>
        <div className="flex flex-wrap items-end gap-6">
          <div className="flex flex-col items-start gap-3">
            <StatDisplay label={`Spend for ${monthData.month}`} value={formatCents(monthlySpentCents)} />
            {delta !== null && (
              <Pill tone={delta > 0 ? "warning" : "success"}>
                {`${delta > 0 ? "\u25b2" : "\u25bc"} ${Math.max(1, Math.round(Math.abs(delta)))}% vs ${previousMonthName}`}
              </Pill>
            )}
            {monthData.hasData && categories.length > 0 && (
              <p className="font-body text-[15px] text-text-secondary">
                Most of this went to <strong className="text-text-primary">{categories[0].category}</strong> ({monthlySpentCents > 0 ? Math.round(categories[0].totalCents / monthlySpentCents * 100) : 0}%)
              </p>
            )}
          </div>
          {monthData.hasData && monthlySpentCents > 0 && (
            <StatDisplay label="Avg/day" value={formatCents(monthlySpentCents / days)} />
          )}
          {monthData.receivedCents > 0 && (
            <StatDisplay label="Received" value={formatCents(monthData.receivedCents)} />
          )}
          {monthData.hasData && (
            <Button variant="secondary" className="sm:ml-auto" onClick={() => setShareOpen(true)}>Share your month</Button>
          )}
        </div>

        {monthData.hasData && (
          <Card aria-label="Net position" className={`border font-body ${net >= 0 ? "border-vivid-violet bg-light-purple text-blackberry" : "border-danger/20 bg-danger/10 text-danger"}`}>
            <p className="font-semibold">
              {net >= 0
                ? `You kept ${formatCents(net)} this month`
                : `You spent ${formatCents(Math.abs(net))} more than you received this month`}
            </p>
            <p className="mt-1 text-[13px]">Received minus spent{monthData.receivedCents > 0 && net >= 0 ? ` / ${Math.round(net / monthData.receivedCents * 100)}% of money in` : ""}</p>
          </Card>
        )}

        <div className="grid grid-cols-4 gap-3">
          <Tile icon={<TransactionsIcon />} label="Log transaction" onClick={() => (window.location.href = "/log-transaction")} />
          <Tile icon={<StatementUploadIcon />} label="Upload statement" onClick={() => (window.location.href = "/statement-upload")} />
          <Tile icon={<BudgetsIcon />} label="Budgets" onClick={() => (window.location.href = "/budgets")} />
          <Tile icon={<BillsIcon />} label="Bills" onClick={() => (window.location.href = "/bills")} />
        </div>
          </>
        )}

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <button type="button" aria-label="Previous month" className="flex h-8 w-8 items-center justify-center rounded-full border border-mid-grey text-text-secondary transition-colors hover:bg-silver-frost" onClick={() => setMonth(shiftMonth(month, -1))}>
              &larr;
            </button>
            <span className="font-body font-semibold">{monthData.month}</span>
            <button type="button" aria-label="Next month" className="flex h-8 w-8 items-center justify-center rounded-full border border-mid-grey text-text-secondary transition-colors hover:bg-silver-frost" onClick={() => setMonth(shiftMonth(month, 1))}>
              &rarr;
            </button>
          </div>

          {!monthData.hasData ? (
            <EmptyState
              message="No spending recorded yet for this month."
              icon={everUsed ? <MonthEmptyIllustration /> : undefined}
              actionLabel={everUsed ? "Upload statement" : undefined}
              onAction={everUsed ? () => (window.location.href = "/statement-upload") : undefined}
            />
          ) : (
            <div className="flex flex-col gap-2">
              {categories.map((c) => {
                const share = monthlySpentCents > 0 ? Math.max(0, Math.min(100, (c.totalCents / monthlySpentCents) * 100)) : 0;
                return (
                  <div key={c.category} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <Pill>{c.category}</Pill>
                      <span className="flex items-baseline gap-2 font-body">
                        <span className="text-[15px] font-semibold">{formatCents(c.totalCents)}</span>
                        <span className="text-[12px] text-text-secondary">{Math.round(share)}%</span>
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-xl bg-mid-grey">
                      <motion.div
                        role="meter"
                        aria-label={`${c.category} share of spending`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={share}
                        className="h-full rounded-xl bg-accent"
                        initial={{ width: reduceMotion ? `${share}%` : "0%" }}
                        animate={{ width: `${share}%` }}
                        transition={{ duration: reduceMotion ? 0 : 0.3 }}
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
            <EmptyState message="No statement imported for this account yet." icon={<HistoryEmptyIllustration />} />
          ) : (
            <div data-testid="trends-history-chart" className="flex items-end gap-2" style={{ height: 145 }}>
              {historyData.months.map((m) => {
                const rupees = m.spentCents / 100;
                const valueLabel = rupees >= 1000 ? `${(rupees / 1000).toFixed(1)}k` : String(rupees);
                return (
                <div key={m.month} className="flex flex-1 flex-col items-center gap-1" title={m.month}>
                  <span className="font-body text-[11px] text-text-secondary">{valueLabel}</span>
                  <div
                    className="w-full rounded-t-sm bg-accent"
                    style={{ height: `${Math.max(2, (m.spentCents / maxHistoryTotal) * 100)}px` }}
                  />
                  <span className="font-body text-[11px] text-text-secondary">{m.month.slice(5)}</span>
                </div>
                );
              })}
            </div>
          )}
        </Card>
        {monthData.hasData && monthData.biggestPurchase && (
          <p className="font-body text-[15px] text-text-secondary">
            <strong className="text-text-primary">A purchase that stood out</strong> / Biggest single purchase: <strong className="text-text-primary">{formatCents(Math.abs(monthData.biggestPurchase.amountCents))} at {monthData.biggestPurchase.vendorRaw}</strong>
          </p>
        )}
        <ShareRecapModal
          key={month}
          open={shareOpen && monthData.hasData}
          onClose={() => setShareOpen(false)}
          month={monthData.month}
          spentCents={monthlySpentCents}
          byCategory={categories}
        />
      </div>
  );
}
