import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
};

// radius-xl, shadow-md, centered overlay on a light-blackberry scrim --
// used for the dedup-resolution confirmation and destructive confirmations.
export function Modal({ open, onClose, children }: ModalProps) {
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          data-testid="modal-overlay"
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-dark-blackberry)]/20"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.15 }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="rounded-xl bg-bg-surface p-6 shadow-[var(--shadow-md)]"
            initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0, scale: 0.96 }}
            transition={{ duration: reduceMotion ? 0 : 0.15 }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
