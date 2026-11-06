import type { ReactNode } from "react";

type TileProps = {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
};

// Horizontal quick action for the Dashboard.
export function Tile({ icon, label, onClick }: TileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-md border border-mid-grey bg-bg-surface px-3.5 py-4 text-left transition-transform active:scale-[0.96]"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center text-accent">{icon}</span>
      <span className="font-body text-[13px] font-semibold text-text-secondary">{label}</span>
      <span aria-hidden="true" className="ml-auto shrink-0">-&gt;</span>
    </button>
  );
}
