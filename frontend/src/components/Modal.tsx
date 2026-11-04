import type { ReactNode } from "react";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
};

// radius-xl, shadow-md, centered overlay on a light-blackberry scrim --
// used for the dedup-resolution confirmation and destructive confirmations.
export function Modal({ open, onClose, children }: ModalProps) {
  if (!open) return null;

  return (
    <div
      data-testid="modal-overlay"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-dark-blackberry)]/20"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-xl bg-bg-surface p-6 shadow-[var(--shadow-md)]"
      >
        {children}
      </div>
    </div>
  );
}
