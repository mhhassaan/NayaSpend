import { useNavigate } from "react-router-dom";
import { EmptyState } from "../components";

export function NotFound() {
  const navigate = useNavigate();

  return (
    <EmptyState
      message="Page not found."
      actionLabel="Go to Dashboard"
      onAction={() => navigate("/")}
    />
  );
}
