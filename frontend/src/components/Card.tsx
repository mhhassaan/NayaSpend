import type { HTMLAttributes, ReactNode } from "react";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

// radius-xl container with shadow-sm, bg-surface background -- the base
// wrapper for list rows, Dedup Review pairs, and Budget/Bill entries.
export function Card({ className = "", children, ...rest }: CardProps) {
  return (
    <div {...rest} className={`bg-bg-surface rounded-xl shadow-[var(--shadow-sm)] p-4 ${className}`}>
      {children}
    </div>
  );
}
