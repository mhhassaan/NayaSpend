import { useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { SpendingRecapCard, type SpendingRecapCardProps } from "./SpendingRecapCard";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { Pill } from "./Pill";

type ShareRecapModalProps = Omit<SpendingRecapCardProps, "mode"> & {
  open: boolean;
  onClose: () => void;
};

export function ShareRecapModal({ open, onClose, month, spentCents, byCategory }: ShareRecapModalProps) {
  const [mode, setMode] = useState<SpendingRecapCardProps["mode"]>("percentages");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setMode("percentages");
      setError(null);
    }
  }, [open]);

  async function download() {
    if (!cardRef.current || exporting) return;
    setExporting(true);
    setError(null);
    try {
      // Only this static card node is captured, excluding the animated modal
      // ancestors, mode controls and download button.
      const dataUrl = await toPng(cardRef.current);
      const link = document.createElement("a");
      link.download = `nayaspend-recap-${month}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      setError("Couldn't download your recap. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="flex max-h-[calc(100dvh-4rem)] w-[min(24rem,calc(100vw-4rem))] flex-col gap-4 overflow-y-auto overscroll-contain">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-[20px] font-semibold">Share your month</h2>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
        <div role="group" aria-label="Recap privacy" className="flex rounded-md bg-silver-frost p-1">
          <Button variant={mode === "percentages" ? "primary" : "secondary"} className="flex-1 !px-3" aria-pressed={mode === "percentages"} onClick={() => setMode("percentages")} disabled={exporting}>Percentages only</Button>
          <Button variant={mode === "amounts" ? "primary" : "secondary"} className="flex-1 !px-3" aria-pressed={mode === "amounts"} onClick={() => setMode("amounts")} disabled={exporting}>With amounts</Button>
        </div>
        <div><Pill>{mode === "percentages" ? "DEFAULT / PRIVATE" : "EXACT AMOUNTS"}</Pill></div>
        <div ref={cardRef} className="p-1">
          <SpendingRecapCard month={month} spentCents={spentCents} byCategory={byCategory} mode={mode} />
        </div>
        {error && <p role="alert" className="font-body text-[13px] text-danger">{error}</p>}
        <Button onClick={download} disabled={exporting}>{exporting ? "Preparing image…" : "Download image"}</Button>
      </div>
    </Modal>
  );
}
