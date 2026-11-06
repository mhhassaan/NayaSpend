import { parseRupeesToCents } from "../utils/money";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { Button, Card, Pill, SidePanelLayout, showError, showSuccess } from "../components";

import { MutationFeedback } from "../components/MutationFeedback";
import { SpinnerIcon } from "../components/icons";
import { useReducedMotion } from "motion/react";

export function LogMissedTransaction() {
  const reduceMotion = useReducedMotion();
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"Money out" | "Money in">("Money out");
  const [date, setDate] = useState("");
  const [result, setResult] = useState<{ category: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const magnitude = Math.abs(parseRupeesToCents(amount));
      const amountCents = direction === "Money out" ? -magnitude : magnitude;
      const args = { json: { vendorRaw: vendor, amountCents, date } };
      const res = await apiClient["missed-transactions"].$post(args);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed to log transaction (${res.status})`);
      }
      return (await res.json()) as { id: number; category: string };
    },
    onSuccess: (data) => {
      setResult({ category: data.category });
      setErrorMessage(null);
      showSuccess("Transaction logged");
      setVendor("");
      setAmount("");
      setDirection("Money out");
      setDate("");
    },
    onError: (err: Error) => {
      setErrorMessage(err.message);
      showError("Couldn't log that transaction.");
    },
  });

  return (
    <SidePanelLayout
      main={
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="font-body text-[20px] font-semibold">Log a missed transaction</h1>
            <p className="font-body text-[15px] text-text-secondary">Add a transaction that wasn't captured automatically.</p>
          </div>
          <Card>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (mutation.isPending) return;
                setResult(null);
                setErrorMessage(null);
                mutation.mutate();
              }}
            >
              <label className="flex flex-col gap-1">
                <span className="font-body text-[13px] font-semibold text-text-secondary">Vendor</span>
                <input
                  aria-label="Vendor" placeholder="e.g. Corner Store"
                  className="rounded-sm border border-mid-grey px-3 py-2"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  required
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
                <span className="font-body text-[13px] font-semibold text-text-secondary">Amount</span>
                <input
                  aria-label="Amount" placeholder="e.g. 1250.00"
                  type="text"
                  inputMode="decimal"
                  className="rounded-sm border border-mid-grey px-3 py-2"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/-/g, ""))}
                  required
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-body text-[13px] font-semibold text-text-secondary">Date</span>
                <input
                  aria-label="Date"
                  type="date"
                  className="rounded-sm border border-mid-grey px-3 py-2"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </label>

              {errorMessage && (
                <MutationFeedback tone="danger">
                  <Pill tone="danger">Failed</Pill>
                  <p className="mt-2">{errorMessage}</p>
                </MutationFeedback>
              )}
              {result && (
                <MutationFeedback tone="success">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>Logged as</span>
                    <Pill tone="success">{result.category}</Pill>
                  </div>
                </MutationFeedback>
              )}

              <Button type="submit" variant="primary" disabled={mutation.isPending} className="flex items-center justify-center gap-2 disabled:cursor-wait disabled:opacity-60">
                {mutation.isPending && <SpinnerIcon data-testid="pending-icon" aria-hidden="true" className={reduceMotion ? "" : "animate-spin"} />}
                {mutation.isPending ? "Logging..." : "Log transaction"}
              </Button>
            </form>
          </Card>
        </div>
      }
      panel={
        <div className="flex flex-col gap-3">
          <h2 className="font-body text-[15px] font-semibold">When to use this</h2>
          <p className="font-body text-[13px] text-text-secondary">Most of your NayaPay transactions are captured automatically from Gmail or a statement import. Use this form for the ones that slip through — cash spending, a missed email, anything the automatic capture didn't catch.</p>
        </div>
      }
    />
  );
}
