import { Toaster, toast } from "sonner";

// Sonner handles stacking/swipe/auto-dismiss (the ask-sonner skill's own
// recommendation); styled via classNames to match frontend-design-system.md's
// Toast spec (radius-lg, shadow-md, color-coded by token) instead of a
// from-scratch animation/stacking engine. Rendered once, high in the tree
// (App.tsx), alongside the showSuccess/showError helpers every mutation
// handler calls on settle.
export function ToastProvider() {
  return (
    <Toaster
      toastOptions={{
        classNames: {
          toast: "rounded-lg shadow-[var(--shadow-md)]",
          success: "toast-success",
          error: "toast-danger",
          warning: "toast-warning",
        },
      }}
    />
  );
}

export function showSuccess(message: string) {
  toast.success(message);
}

export function showError(message: string) {
  toast.error(message);
}
