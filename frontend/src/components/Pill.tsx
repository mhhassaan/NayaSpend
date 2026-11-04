import type { ReactNode } from "react";

type PillTone = "neutral" | "success" | "warning" | "danger";

type PillProps = {
  tone?: PillTone;
  children: ReactNode;
};

const TONE_CLASSES: Record<PillTone, string> = {
  neutral: "bg-silver-frost text-text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
};

// radius-pill small label -- category tags, reviewStatus/dedupResolution
// state indicators, and Capture Health status chips.
export function Pill({ tone = "neutral", children }: PillProps) {
  return (
    <span className={`${TONE_CLASSES[tone]} rounded-full px-3 py-1 font-body text-[13px] font-semibold`}>
      {children}
    </span>
  );
}
