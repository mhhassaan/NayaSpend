import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { Button, showError, showSuccess } from "../components";

const ACCEPTED_CONTENT_TYPES = new Set(["text/csv", "text/plain", "application/vnd.ms-excel"]);

// Mirrors the backend's own looksLikeCsv check (statements.ts) so the user
// gets instant feedback instead of waiting on a round trip for the same
// rejection.
function looksLikeCsv(file: File): boolean {
  if (file.name.toLowerCase().endsWith(".csv")) return true;
  return ACCEPTED_CONTENT_TYPES.has(file.type);
}

export function StatementUpload() {
  const [file, setFile] = useState<File | null>(null);
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

  function handleUpload() {
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
    <div className="flex max-w-sm flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="font-body text-[13px] font-semibold text-text-secondary">Choose file</span>
        {/* No `accept` filter: our own validation below (mirroring the
            backend's looksLikeCsv) is the one source of truth for what's
            rejected and why, rather than relying on the OS file picker's
            inconsistent-across-browsers accept-attribute enforcement. */}
        <input aria-label="Choose file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>

      {clientError && <p className="font-body text-[13px] text-danger">{clientError}</p>}
      {serverError && <p className="font-body text-[13px] text-danger">{serverError}</p>}
      {result && (
        <p className="font-body text-[13px] text-success">
          Imported {result.imported} row{result.imported === 1 ? "" : "s"}
        </p>
      )}

      <Button variant="primary" onClick={handleUpload}>
        Upload
      </Button>
    </div>
  );
}
