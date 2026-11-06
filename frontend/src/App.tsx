import { Outlet, type RouteObject } from "react-router-dom";
import { AppShell } from "./components";
import { NotFound } from "./pages/NotFound";
import { ErrorPage } from "./pages/ErrorPage";
import { Dashboard } from "./pages/Dashboard";
import { Transactions } from "./pages/Transactions";
import { DedupReview } from "./pages/DedupReview";
import { LogMissedTransaction } from "./pages/LogMissedTransaction";
import { StatementUpload } from "./pages/StatementUpload";
import { Budgets } from "./pages/Budgets";
import { Bills } from "./pages/Bills";
import { CaptureHealth } from "./pages/CaptureHealth";
import { Landing } from "./pages/Landing";
import { Terms } from "./pages/Terms";
import { Privacy } from "./pages/Privacy";
import { Login } from "./pages/Login";

// Plain data, no router instance created here -- `createBrowserRouter`
// (main.tsx) and `createMemoryRouter` (tests) each attach their own
// internal state to the route objects they're given, so sharing one
// router's already-consumed objects with a second router causes the
// second one to error. Exporting only the data keeps `routes` reusable;
// each caller builds its own router from it.
//
// Pages (Tasks 9-16) each add their own child route here, registering
// against the already-stable shell/404/error-boundary structure built in
// this task.
//
// [Phase 8 Task 12] `/login`, `/welcome`, `/terms` and `/privacy` are siblings of the AppShell-rooted route,
// not a child of it, so it never goes through the auth guard main.tsx
// wraps that route's element in -- a route tests build their own router
// from (see App.test.tsx) sees this exact plain structure, unauthenticated
// and ungated, same as before this task.
export const routes: RouteObject[] = [
  {
    path: "/",
    element: (
      <AppShell>
        <Outlet />
      </AppShell>
    ),
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "transactions", element: <Transactions /> },
      { path: "dedup-review", element: <DedupReview /> },
      { path: "log-transaction", element: <LogMissedTransaction /> },
      { path: "statement-upload", element: <StatementUpload /> },
      { path: "budgets", element: <Budgets /> },
      { path: "bills", element: <Bills /> },
      { path: "capture-health", element: <CaptureHealth /> },
      { path: "*", element: <NotFound /> },
    ],
  },
  { path: "/welcome", element: <Landing /> },
  { path: "/login", element: <Login /> },
  { path: "/terms", element: <Terms /> },
  { path: "/privacy", element: <Privacy /> },
];
