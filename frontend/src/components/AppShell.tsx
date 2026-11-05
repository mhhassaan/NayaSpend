import type { ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { PageTransition } from "./PageTransition";
import { showError } from "./ToastProvider";
import {
  BillsIcon,
  BudgetsIcon,
  CaptureHealthIcon,
  DashboardIcon,
  DedupIcon,
  TransactionsIcon,
} from "./icons";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: DashboardIcon },
  { to: "/transactions", label: "Transactions", icon: TransactionsIcon },
  { to: "/dedup-review", label: "Dedup Review", icon: DedupIcon },
  { to: "/budgets", label: "Budgets", icon: BudgetsIcon },
  { to: "/bills", label: "Bills", icon: BillsIcon },
  { to: "/capture-health", label: "Capture Health", icon: CaptureHealthIcon },
] as const;

function navLinkClass({ isActive }: { isActive: boolean }) {
  return `flex items-center gap-3 rounded-md px-3 py-2 font-body text-[15px] font-medium transition-colors ${
    isActive ? "bg-light-purple text-accent" : "text-text-secondary hover:bg-silver-frost"
  }`;
}

// Shared layout with a desktop sidebar and mobile app-name bar and bottom
// tabs for navigation between the primary pages. Transaction actions live
// on the Transactions page and Dashboard's quick-action Tile grid.
export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();

  async function signOut() {
    try {
      await fetch("/api/auth/google/logout", { method: "POST", credentials: "include" });
    } catch {
      showError("Couldn't sign out -- try again.");
      return;
    }
    navigate("/login");
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="hidden w-60 flex-col gap-1 border-r border-mid-grey bg-bg-surface p-4 md:flex">
        <div className="mb-4 px-3 font-display text-[20px] font-bold text-blackberry">NayaSpend</div>
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={navLinkClass} end={to === "/"}>
            <Icon />
            {label}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={signOut}
          className="mt-auto flex items-center gap-3 rounded-md px-3 py-2 font-body text-[15px] font-medium text-text-secondary transition-colors hover:bg-silver-frost"
        >
          Sign out
        </button>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-mid-grey bg-bg-surface px-4 py-3 md:hidden">
          <span className="font-display text-[18px] font-bold text-blackberry">NayaSpend</span>
          <button type="button" onClick={signOut} className="font-body text-[13px] font-medium text-text-secondary">
            Sign out
          </button>
        </header>

        <main className="flex-1 p-4 pb-20 md:pb-4">
          <PageTransition key={location.pathname}>{children}</PageTransition>
        </main>

        <nav className="fixed inset-x-0 bottom-0 flex items-center justify-around border-t border-mid-grey bg-bg-surface py-2 md:hidden">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) => `flex flex-col items-center gap-1 px-2 text-[11px] ${isActive ? "text-accent" : "text-deep-grey"}`}
            >
              <Icon />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
