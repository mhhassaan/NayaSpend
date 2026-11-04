import { Outlet, type RouteObject } from "react-router-dom";
import { AppShell } from "./components";
import { NotFound } from "./pages/NotFound";
import { ErrorPage } from "./pages/ErrorPage";

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
      { path: "*", element: <NotFound /> },
    ],
  },
];
