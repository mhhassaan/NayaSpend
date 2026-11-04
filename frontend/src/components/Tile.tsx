import type { ReactNode } from "react";

type TileProps = {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
};

// radius-lg square-ish tile with a centered icon and a text-label caption
// below -- matches NayaPay's in-app service-tile grid pattern. Used for
// any settings/action grid (Dashboard's quick-action Tile grid).
export function Tile({ icon, label, onClick }: TileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-lg bg-bg-surface p-4 shadow-[var(--shadow-sm)] transition-transform active:scale-[0.96]"
    >
      <span className="flex h-8 w-8 items-center justify-center text-accent">{icon}</span>
      <span className="font-body text-[13px] font-semibold text-text-secondary">{label}</span>
    </button>
  );
}
