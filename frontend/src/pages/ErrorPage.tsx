import { useNavigate, useRouteError } from "react-router-dom";
import { EmptyState } from "../components";

// Catches render/loader throws per-route (errorElement). Never shows the
// raw error to the user -- logged for diagnosis, not displayed.
export function ErrorPage() {
  const error = useRouteError();
  const navigate = useNavigate();

  if (error) {
    console.error("Route error:", error);
  }

  return (
    <EmptyState
      message="Something went wrong."
      actionLabel="Go to Dashboard"
      onAction={() => navigate("/")}
    />
  );
}
