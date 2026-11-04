import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/index.css";

// Full routing/providers (QueryClientProvider, RouterProvider, ToastProvider)
// are wired up in Task 8 -- this proves the Vite+React+TS pipeline builds
// and runs before anything else depends on it.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <div>NayaSpend</div>
  </React.StrictMode>
);
