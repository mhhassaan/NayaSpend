import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "danger";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  children: ReactNode;
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-blackberry text-hyper-white rounded-md",
  secondary: "bg-hyper-white text-blackberry rounded-sm border border-mid-grey",
  danger: "bg-hot-red text-hyper-white rounded-md",
};

// Sentence case labels, no uppercase transform, no heavy shadow, subtle
// scale-down on press rather than a color-only active state -- per
// frontend-design-system.md's Button spec.
export function Button({ variant = "primary", className = "", children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={`${VARIANT_CLASSES[variant]} px-6 py-3 font-body font-semibold text-[15px] transition-transform active:scale-[0.96] ${className}`}
    >
      {children}
    </button>
  );
}
