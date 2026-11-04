import type { ReactNode } from "react";
import { Button } from "./Button";

type EmptyStateProps = {
  icon?: ReactNode;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

// Icon/illustration slot + text-body-lg message + optional action button.
// Used wherever the design doc calls for explicit sparse/missing-coverage
// states (Dashboard trends, an empty list, Budgets/Bills before any exist).
export function EmptyState({ icon, message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-4 p-8 text-center">
      {icon}
      <p className="font-body text-[18px] text-text-secondary">{message}</p>
      {actionLabel && onAction && (
        <Button variant="primary" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
