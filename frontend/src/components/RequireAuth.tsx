import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { apiClient } from "../api/client";

type AuthStatus = "pending" | "authenticated" | "unauthenticated";

export function RequireAuth({ children, redirectTo = "/login" }: { children: ReactNode; redirectTo?: string }) {
  const [status, setStatus] = useState<AuthStatus>("pending");

  useEffect(() => {
    let cancelled = false;
    apiClient.auth.google.me
      .$get()
      .then((res) => {
        if (cancelled) return;
        setStatus(res.ok ? "authenticated" : "unauthenticated");
      })
      .catch(() => {
        if (!cancelled) setStatus("unauthenticated");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "pending") {
    return (
      <div data-testid="auth-skeleton" className="flex min-h-screen items-center justify-center">
        <div className="h-16 w-16 animate-pulse rounded-xl bg-mid-grey" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <Navigate to={redirectTo} replace />;
  }

  return <>{children}</>;
}
