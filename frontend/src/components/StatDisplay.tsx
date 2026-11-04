import type { ReactNode } from "react";

type StatDisplayProps = {
  label: string;
  value: string;
  trailingIcon?: ReactNode;
};

// The balance/amount display pattern: a small label line above, a large
// figure below, with an optional trailing icon slot (hide/show toggle on
// Dashboard's total-spend figure, or a trend arrow on category breakdowns).
export function StatDisplay({ label, value, trailingIcon }: StatDisplayProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-body text-[15px] text-text-secondary">{label}</span>
      <span className="flex items-center gap-2 font-body text-[36px] font-bold leading-[1.1] text-text-primary">
        {value}
        {trailingIcon}
      </span>
    </div>
  );
}
