import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Card } from "./Card";
import { CheckIcon, WarningIcon } from "./icons";

export function MutationFeedback({ tone, children }: { tone: "success" | "danger"; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const success = tone === "success";
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, transform: "scale(0.97)" }}
      animate={{ opacity: 1, transform: "scale(1)" }}
      transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.23, 1, 0.32, 1] }}
    >
      <Card role={success ? "status" : "alert"} className={`flex items-start gap-3 border ${success ? "border-success text-success" : "border-danger text-danger"}`}>
        {success ? <CheckIcon data-testid="success-icon" aria-hidden="true" className="mt-1 shrink-0" /> : <WarningIcon data-testid="error-icon" aria-hidden="true" className="mt-1 shrink-0" />}
        <div className="min-w-0 flex-1 break-words font-body text-[13px]">{children}</div>
      </Card>
    </motion.div>
  );
}
