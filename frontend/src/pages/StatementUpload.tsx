import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { Button, Card, Pill, SidePanelLayout, showError, showSuccess } from "../components";
import { CheckIcon, SpinnerIcon, StatementUploadIcon } from "../components/icons";

import { MutationFeedback } from "../components/MutationFeedback";
import { useReducedMotion } from "motion/react";

const ACCEPTED_CONTENT_TYPES = new Set(["text/csv", "text/plain", "application/vnd.ms-excel"]);

// Mirrors the backend's own looksLikeCsv check (statements.ts) so the user
// gets instant feedback instead of waiting on a round trip for the same
// rejection.
function looksLikeCsv(file: File): boolean {
  if (file.name.toLowerCase().endsWith(".csv")) return true;
  return ACCEPTED_CONTENT_TYPES.has(file.type);
}

export function StatementUpload() {
  const reduceMotion = useReducedMotion();
  const [activeStep, setActiveStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number } | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      // Hono's RPC client builds the FormData itself from a plain object
      // (args.form, via Object.entries) -- it does not accept an
      // already-constructed FormData instance here. Passing one silently
      // produces an empty body, since FormData's entries aren't
      // enumerable own properties: Object.entries(aFormData) is [].
      const args = { form: { file: file! } };
      const res = await apiClient.statements.$post(args);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed to upload statement (${res.status})`);
      }
      return (await res.json()) as { imported: number };
    },
    onSuccess: (data) => {
      setResult(data);
      setServerError(null);
      showSuccess(`Imported ${data.imported} row${data.imported === 1 ? "" : "s"}`);
    },
    onError: (err: Error) => {
      setServerError(err.message);
      showError("Couldn't upload that statement.");
    },
  });

  useEffect(() => {
    if (!mutation.isPending) return;
    setActiveStep(0);
    // Illustrative activity only: the RPC exposes no per-stage progress.
    const interval = window.setInterval(() => setActiveStep((step) => Math.min(step + 1, 2)), 700);
    return () => window.clearInterval(interval);
  }, [mutation.isPending]);

  function handleUpload() {
    if (mutation.isPending) return;
    setResult(null);
    setServerError(null);
    if (!file) {
      setClientError("Choose a file first.");
      return;
    }
    if (!looksLikeCsv(file)) {
      setClientError("File must be a CSV (.csv extension or a CSV content type).");
      return;
    }
    setClientError(null);
    mutation.mutate();
  }

  return (
    <SidePanelLayout
      main={
        <Card>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h1 className="font-body text-[20px] font-semibold">Upload a statement</h1>
              <p className="font-body text-[15px] text-text-secondary">Import transactions from your CSV statement.</p>
            </div>
            <div
              role="region"
              aria-label="Statement file drop zone"
              className={`flex flex-col items-center gap-4 rounded-xl border-2 border-dashed p-8 text-center ${isDragging ? "border-accent" : "border-mid-grey"}`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                setFile(e.dataTransfer.files[0] ?? null);
                if (inputRef.current) inputRef.current.value = "";
              }}
            >
              <StatementUploadIcon width={40} height={40} className="text-accent" aria-hidden="true" />
              <p className="font-body text-[15px]">Drag and drop your CSV here, or</p>
              <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()}>
                Browse files
              </Button>
            </div>
            {/* No `accept` filter: our own validation below (mirroring the
                backend's looksLikeCsv) is the one source of truth for what's
                rejected and why, rather than relying on the OS file picker's
                inconsistent-across-browsers accept-attribute enforcement. */}
            <input ref={inputRef} className="sr-only" aria-label="Choose file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {file && (
              <div className="flex items-center justify-between gap-3 rounded-sm bg-silver-frost p-3 font-body text-[13px]">
                <span className="min-w-0 break-words font-semibold">{file.name}</span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setFile(null);
                    if (inputRef.current) inputRef.current.value = "";
                  }}
                >
                  Remove
                </Button>
              </div>
            )}

            {clientError && (
              <MutationFeedback tone="danger">
                <Pill tone="danger">Check file</Pill>
                <p className="mt-2">{clientError}</p>
              </MutationFeedback>
            )}
            {serverError && (
              <MutationFeedback tone="danger">
                <Pill tone="danger">Failed</Pill>
                <p className="mt-2">{serverError}</p>
              </MutationFeedback>
            )}
            {result && (
              <MutationFeedback tone="success">
                <Pill tone="success">Imported {result.imported} row{result.imported === 1 ? "" : "s"}</Pill>
              </MutationFeedback>
            )}

            {mutation.isPending && (
              <div className="rounded-lg border border-border p-4">
                <p className="mb-3 font-body text-[13px] text-text-secondary">Import activity</p>
                <ol aria-label="Import activity" className="flex items-start">
                  {["Uploading", "Parsing rows", "Importing"].map((label, index) => (
                    <li key={label} aria-current={activeStep === index ? "step" : undefined}
                      className={`flex min-w-0 flex-1 flex-col gap-2 font-body text-[13px] ${index <= activeStep ? "text-accent" : "text-text-secondary"}`}>
                      <div className="flex items-center">
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${index <= activeStep ? "border-accent bg-accent text-hyper-white" : "border-border"}`}>
                          {index < activeStep ? <CheckIcon data-testid="step-complete-icon" aria-hidden="true" width={18} height={18} /> : index + 1}
                        </span>
                        {index < 2 && <span aria-hidden="true" className={`h-px flex-1 ${index < activeStep ? "bg-accent" : "bg-border"}`} />}
                      </div>
                      <span>{label}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <Button variant="primary" onClick={handleUpload} disabled={mutation.isPending} className="flex items-center justify-center gap-2 disabled:cursor-wait disabled:opacity-60">
              {mutation.isPending && <SpinnerIcon data-testid="pending-icon" aria-hidden="true" className={reduceMotion ? "" : "animate-spin"} />}
              {mutation.isPending ? "Importing..." : "Upload"}
            </Button>
          </div>
        </Card>
      }
      panel={
        <div className="flex flex-col gap-3">
          <h2 className="font-body text-[15px] font-semibold">What happens next</h2>
          <ul className="flex flex-col gap-2 font-body text-[13px] text-text-secondary">
            <li>We read the Date, Description, and Amount columns from your bank's CSV export.</li>
            <li>Possible duplicates are flagged for review, never silently double-counted.</li>
            <li>Everything stays in your own account — nothing is shared with anyone else.</li>
          </ul>
        </div>
      }
    />
  );
}
