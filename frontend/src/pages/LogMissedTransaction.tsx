import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { Button, Card, SidePanelLayout, showError, showSuccess } from "../components";

export function LogMissedTransaction() {
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [result, setResult] = useState<{ category: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const amountCents = Math.round(Number.parseFloat(amount) * 100);
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
                setResult(null);
                mutation.mutate();
              }}
            >
              <label className="flex flex-col gap-1">
                <span className="font-body text-[13px] font-semibold text-text-secondary">Vendor</span>
                <input
                  aria-label="Vendor"
                  className="rounded-sm border border-mid-grey px-3 py-2"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  required
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-body text-[13px] font-semibold text-text-secondary">Amount</span>
                <input
                  aria-label="Amount"
                  type="text"
                  inputMode="decimal"
                  className="rounded-sm border border-mid-grey px-3 py-2"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
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

              {errorMessage && <p className="font-body text-[13px] text-danger">{errorMessage}</p>}
              {result && <p className="font-body text-[13px] text-success">Logged as {result.category}</p>}

              <Button type="submit" variant="primary">
                Log transaction
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
