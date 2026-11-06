import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { routes } from "./App";
import { RequireAuth } from "./components/RequireAuth";
import { ToastProvider } from "./components";
import "./styles/index.css";

const queryClient = new QueryClient();

// [Phase 8 Task 12] The auth guard wraps the AppShell-rooted route's own
// element HERE, not inside App.tsx's exported `routes` -- App.test.tsx
// builds its own router straight from `routes` with no fetch mock and no
// auth setup, so wrapping it there would break that file. This transform
// only affects the real, production router.
const guardedRoutes = routes.map((route) =>
  route.path === "/" ? { ...route, element: <RequireAuth>{route.element}</RequireAuth> } : route
);
const router = createBrowserRouter(guardedRoutes);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <ToastProvider />
    </QueryClientProvider>
  </React.StrictMode>
);
