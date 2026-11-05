import { BillsEmptyIllustration } from "../components/illustrations";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { Button, Card, EmptyState, ListReveal, Modal, Pill, showError, showSuccess } from "../components";
import type { Bill } from "../types/transaction";
import { formatCents, parseRupeesToCents } from "../utils/money";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Check the due date before submitting by round-tripping through Date --
// the regex alone accepts calendar-impossible values like "2026-02-31".
function isValidIsoDate(date: string): boolean {
  if (!ISO_DATE_PATTERN.test(date)) return false;
  return new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}

type BillFormState = { vendor: string; expectedAmount: string; expectedInterval: string; nextDueDate: string };

function validateBillForm(form: BillFormState): string | null {
  if (!form.vendor.trim()) return "Enter a vendor name.";
  const expectedAmountCents = parseRupeesToCents(form.expectedAmount);
  if (!Number.isFinite(expectedAmountCents) || expectedAmountCents <= 0) {
    return "Enter an expected amount greater than zero.";
  }
  if (!isValidIsoDate(form.nextDueDate)) {
    return "Enter a valid due date in YYYY-MM-DD format.";
  }
  if (!form.expectedInterval.trim()) return "Enter how often this bill repeats (e.g. monthly).";
  return null;
}

function BillFormFields({ form, onChange }: { form: BillFormState; onChange: (form: BillFormState) => void }) {
  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="font-body text-[13px] font-semibold text-text-secondary">Vendor</span>
        <input
          aria-label="Vendor" placeholder="e.g. Netflix"
          className="rounded-sm border border-mid-grey px-3 py-2"
          value={form.vendor}
          onChange={(e) => onChange({ ...form, vendor: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-body text-[13px] font-semibold text-text-secondary">Expected amount (Rs.)</span>
        <input
          aria-label="Expected amount" placeholder="e.g. 1500"
          type="text"
          inputMode="numeric"
          className="rounded-sm border border-mid-grey px-3 py-2"
          value={form.expectedAmount}
          onChange={(e) => onChange({ ...form, expectedAmount: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-body text-[13px] font-semibold text-text-secondary">Expected interval</span>
        <input
          aria-label="Expected interval" placeholder="e.g. monthly"
          className="rounded-sm border border-mid-grey px-3 py-2"
          value={form.expectedInterval}
          onChange={(e) => onChange({ ...form, expectedInterval: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-body text-[13px] font-semibold text-text-secondary">Next due date</span>
        <input
          aria-label="Next due date" placeholder="YYYY-MM-DD"
          className="rounded-sm border border-mid-grey px-3 py-2"
          value={form.nextDueDate}
          onChange={(e) => onChange({ ...form, nextDueDate: e.target.value })}
        />
      </label>
    </>
  );
}

function CreateBillForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState<BillFormState>({ vendor: "", expectedAmount: "", expectedInterval: "", nextDueDate: "" });
  const [clientError, setClientError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const args = {
        json: { vendor: form.vendor, expectedAmount: parseRupeesToCents(form.expectedAmount), expectedInterval: form.expectedInterval, nextDueDate: form.nextDueDate },
      };
      const res = await apiClient.bills.$post(args);
      if (!res.ok) throw new Error((await res.text()) || `Failed to create bill (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      showSuccess("Bill added");
      queryClient.invalidateQueries({ queryKey: ["bills"] });
      onDone();
    },
    onError: (err: Error) => {
      setClientError(err.message);
      showError("Couldn't add that bill.");
    },
  });

  function handleSave() {
    const error = validateBillForm(form);
    if (error) {
      setClientError(error);
      return;
    }
    setClientError(null);
    mutation.mutate();
  }

  return (
    <div className="flex flex-col gap-3">
      <BillFormFields form={form} onChange={setForm} />
      {clientError && <p className="font-body text-[13px] text-danger">{clientError}</p>}
      <Button variant="primary" onClick={handleSave}>
        Save
      </Button>
    </div>
  );
}

function EditBillForm({ bill, onDone }: { bill: Bill; onDone: () => void }) {
  const [form, setForm] = useState<BillFormState>({
    vendor: bill.vendor,
    expectedAmount: String(bill.expectedAmount / 100),
    expectedInterval: bill.expectedInterval,
    nextDueDate: bill.nextDueDate,
  });
  const [clientError, setClientError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const args = {
        param: { id: String(bill.id) },
        json: { vendor: form.vendor, expectedAmount: parseRupeesToCents(form.expectedAmount), expectedInterval: form.expectedInterval, nextDueDate: form.nextDueDate },
      };
      const res = await apiClient.bills[":id"].$patch(args);
      if (!res.ok) throw new Error((await res.text()) || `Failed to update bill (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      showSuccess("Bill updated");
      queryClient.invalidateQueries({ queryKey: ["bills"] });
      onDone();
    },
    onError: (err: Error) => {
      setClientError(err.message);
      showError("Couldn't update that bill.");
    },
  });

  function handleSave() {
    const error = validateBillForm(form);
    if (error) {
      setClientError(error);
      return;
    }
    setClientError(null);
    mutation.mutate();
  }

  return (
    <div className="flex flex-col gap-3">
      <BillFormFields form={form} onChange={setForm} />
      {clientError && <p className="font-body text-[13px] text-danger">{clientError}</p>}
      <Button variant="primary" onClick={handleSave}>
        Save
      </Button>
    </div>
  );
}

function BillRow({ bill }: { bill: Bill }) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const args = { param: { id: String(bill.id) } };
      const res = await apiClient.bills[":id"].$delete(args);
      if (!res.ok) throw new Error(`Failed to delete bill (${res.status})`);
    },
    onSuccess: () => {
      showSuccess("Bill deleted");
      queryClient.invalidateQueries({ queryKey: ["bills"] });
      setConfirmingDelete(false);
    },
    onError: () => showError("Couldn't delete that bill."),
  });

  if (editing) {
    return (
      <Card>
        <EditBillForm bill={bill} onDone={() => setEditing(false)} />
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <span className="font-body font-semibold">{bill.vendor}</span>
          <span className="font-body text-[15px] text-text-secondary">{formatCents(bill.expectedAmount)}</span>
        </div>
        <div className="flex items-center gap-3">
          <Pill>{bill.nextDueDate}</Pill>
          <button type="button" className="rounded-sm border border-mid-grey px-3 py-1 text-[13px]" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button
            type="button"
            className="rounded-sm border border-mid-grey px-3 py-1 text-[13px]"
            onClick={() => setConfirmingDelete(true)}
          >
            Delete
          </button>
        </div>
      </div>
      <Modal open={confirmingDelete} onClose={() => setConfirmingDelete(false)}>
        <div className="flex flex-col gap-4">
          <p className="font-body text-[15px]">Delete the {bill.vendor} bill?</p>
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

export function Bills() {
  const [creating, setCreating] = useState(false);

  const billsQuery = useQuery({
    queryKey: ["bills"],
    queryFn: async () => {
      const res = await apiClient.bills.$get();
      if (!res.ok) throw new Error(`Failed to load bills (${res.status})`);
      return (await res.json()) as Bill[];
    },
  });

  useEffect(() => {
    if (billsQuery.isError) showError("Couldn't load your bills.");
  }, [billsQuery.isError]);

  if (billsQuery.isPending) {
    return (
      <div data-testid="bills-skeleton" className="flex flex-col gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-mid-grey" />
        ))}
      </div>
    );
  }

  if (billsQuery.isError) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p className="font-body text-[18px] text-text-secondary">Couldn't load your bills.</p>
        <button
          type="button"
          className="rounded-md bg-blackberry px-6 py-3 font-body text-[15px] font-semibold text-hyper-white"
          onClick={() => billsQuery.refetch()}
        >
          Retry
        </button>
      </div>
    );
  }

  const billsList = billsQuery.data!;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-body text-[20px] font-semibold">Bills</h1>
        <Button variant="primary" onClick={() => setCreating(true)}>
          Add bill
        </Button>
      </div>

      {creating && (
        <Card>
          <CreateBillForm onDone={() => setCreating(false)} />
        </Card>
      )}

      {billsList.length === 0 ? (
        <EmptyState icon={<BillsEmptyIllustration />} message="No bills yet." />
      ) : (
        <ListReveal items={billsList.map((b) => (
            <BillRow key={b.id} bill={b} />
          ))} />
      )}
    </div>
  );
}
