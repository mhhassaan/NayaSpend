# Frontend Design System

*   **Author:** mh.hassaan03@gmail.com
*   **Status:** Proposed
*   **Date:** 2026-11-02

--------------------------------------------------------------------------------

## Overview

A shared design system — tokens, a small component library, and page-layout
rules — so the spending tracker's 12 frontend pages (Dashboard,
Transactions, Dedup Review, Log Missed Transaction, Statement Upload,
Budgets, Bills, Capture Health, plus routing shell) look and behave like
one coherent app instead of 12 independently-styled screens. It implements
the visual language from `docs/brand/nayapay-inspired-brand-guidelines.md`
as concrete, reusable code rather than a reference document each page
author would otherwise have to reinterpret by hand.

## The Problem

The finalized design (`docs/designs/personal-spending-tracker.md`) lists
nine frontend page files (items 37-44) and no shared UI layer between them
— no common Button, no shared layout shell, no single place colors or type
are defined. Built independently, each page would likely diverge: slightly
different button paddings, inconsistent spacing, ad hoc color choices per
developer/session. For a finance app specifically, visual inconsistency
reads as untrustworthy — a balance display that looks different on the
Dashboard than on Capture Health, or a button that behaves differently on
Budgets than on Bills, undermines confidence in the numbers themselves.

This document defines the tokens and components once, so every page
consumes the same primitives instead of re-deriving them.

## Goals

*   **Design tokens.** One source of truth for color, typography, spacing,
    radius, and shadow values, implemented as Tailwind config + CSS custom
    properties, consumed by every component and page.
*   **A small, reusable component library.** Button, Card, Input, Pill/Badge,
    StatDisplay, Tile, EmptyState, Toast, Modal, and navigation shell
    components — built once, used everywhere, instead of per-page
    one-offs.
*   **A consistent app shell.** One layout wrapper (top bar + navigation)
    that every page renders inside, so navigation placement and behavior
    don't vary page to page.
*   **Consistent data-display patterns.** One way to show a currency
    amount, one way to show a date, one way to show an empty state, one
    way to show a loading state — reused across Dashboard, Transactions,
    Budgets, and Bills rather than each page inventing its own.
*   **Responsive by default.** Every shared component works from narrow
    mobile-browser widths up through desktop, since statement upload and
    transaction logging are plausible to do from a phone browser even
    though this is a web app, not a native app.

## Non-Goals

*   **A general-purpose component library for reuse outside this project.**
    Components are built for this app's specific needs, not published as a
    standalone package.
*   **Dark mode.** Not required for v1. Tokens are implemented as CSS
    custom properties specifically so dark mode is a cheap follow-up
    later (swap the custom-property values under a `[data-theme="dark"]`
    selector) rather than a rewrite — but no dark palette is defined here.
*   **Animation/motion system.** Beyond simple, standard transitions
    (hover states, the ~8% press-scale noted in the brand guidelines),
    no dedicated animation library or motion spec is defined.
*   **Native mobile app styling.** This is a responsive web app; no
    React Native / platform-specific design tokens are in scope.
*   **A component for every possible future need.** Only components the
    nine planned pages actually require are built now; new components are
    added when a page needs one, not speculatively.

## Design Tokens

All values are taken directly from
`docs/brand/nayapay-inspired-brand-guidelines.md` — this section is the
implementation of that document's palette/type/spacing sections as code,
not a new set of design decisions.

### Color tokens (CSS custom properties)

```css
:root {
  /* Neutrals */
  --color-dark-blackberry: #1e141e;
  --color-blackberry: #381d2a;
  --color-hyper-white: #fcf9fb;
  --color-silver-frost: #f0eaed;
  --color-deep-grey: #8c8085;
  --color-mid-grey: #d9d2d5;
  --color-lightest-grey: #ddcbd1;

  /* Brand accents */
  --color-electric-orange: #ff5018;
  --color-hot-red: #c71e06;
  --color-deep-violet: #9048c4;
  --color-vivid-violet: #c4b8ff;
  --color-light-purple: #ece8fd;
  --color-bubblegum: #ffc6d4;

  /* Semantic aliases — components reference these, not raw colors,
     so a future re-theme only touches this block */
  --color-bg-page: var(--color-silver-frost);
  --color-bg-surface: var(--color-hyper-white);
  --color-bg-inverse: var(--color-blackberry);
  --color-text-primary: var(--color-blackberry);
  --color-text-secondary: var(--color-deep-grey);
  --color-text-inverse: var(--color-hyper-white);
  --color-border: var(--color-mid-grey);
  --color-accent: var(--color-electric-orange);
  --color-success: #1e8a4c;   /* not from NayaPay's palette — see note below */
  --color-warning: var(--color-electric-orange);
  --color-danger: var(--color-hot-red);
}
```

**Note on `--color-success`**: NayaPay's captured palette has no green —
every accent is warm (orange/red/purple/pink). This app needs a positive/
success color (e.g. "transaction categorized," "budget on track") that
reads as unambiguously positive, which none of the warm accents do
cleanly. A green was added as the one token not sourced from NayaPay's
site; pick the exact shade during implementation by checking contrast
against `--color-bg-surface` and `--color-bg-page`.

### Typography tokens

```css
:root {
  --font-display: 'Poppins', Verdana, sans-serif;
  --font-body: 'DM Sans', sans-serif;

  --text-display-lg: 700 48px/1.1 var(--font-display);   /* page titles, scaled down from the marketing site's 80px — appropriate for app UI, not a hero */
  --text-display-md: 700 32px/1.2 var(--font-display);   /* section headers */
  --text-balance: 700 36px/1.1 var(--font-body);         /* large balance/amount figures — DM Sans, not Poppins, matching the in-app mockup */
  --text-body-lg: 400 18px/1.5 var(--font-body);
  --text-body: 400 15px/1.5 var(--font-body);
  --text-body-sm: 400 13px/1.4 var(--font-body);
  --text-label: 600 13px/1.3 var(--font-body);           /* tile labels, form labels */
  --text-button: 600 15px/1 var(--font-body);
}
```

### Spacing & radius tokens

```css
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;  /* matches NayaPay's --card-gap */
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;

  --radius-sm: 8px;    /* secondary buttons, inputs */
  --radius-md: 10px;   /* primary buttons */
  --radius-lg: 16px;   /* tiles, small cards */
  --radius-xl: 24px;   /* large cards, modals */
  --radius-pill: 9999px; /* search bars, badges */
}
```

### Shadow tokens

NayaPay's own UI is largely flat (no heavy drop shadows observed). One
subtle elevation level is enough for this app's needs (cards resting on
the page background, modals above content):

```css
:root {
  --shadow-sm: 0 1px 2px rgba(30, 20, 30, 0.06);
  --shadow-md: 0 4px 12px rgba(30, 20, 30, 0.10);
}
```

### Tailwind config

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        blackberry: '#381d2a',
        'dark-blackberry': '#1e141e',
        'hyper-white': '#fcf9fb',
        'silver-frost': '#f0eaed',
        'deep-grey': '#8c8085',
        'mid-grey': '#d9d2d5',
        'lightest-grey': '#ddcbd1',
        'electric-orange': '#ff5018',
        'hot-red': '#c71e06',
        'deep-violet': '#9048c4',
        'vivid-violet': '#c4b8ff',
        'light-purple': '#ece8fd',
        bubblegum: '#ffc6d4',
      },
      fontFamily: {
        display: ['Poppins', 'Verdana', 'sans-serif'],
        body: ['DM Sans', 'sans-serif'],
      },
      borderRadius: {
        sm: '8px', md: '10px', lg: '16px', xl: '24px',
      },
    },
  },
};
```

## Component Library

Each component is specified by purpose, variants, and which pages use it —
not full prop signatures, left to implementation.

### `Button`
*   **Variants**: `primary` (blackberry bg, hyper-white text, radius-md —
    main actions), `secondary` (hyper-white bg, blackberry text, radius-sm,
    1px border — used on dark surfaces or as a lower-emphasis action),
    `danger` (hot-red bg, hyper-white text — destructive actions like
    discarding a dedup candidate).
*   Sentence case labels, no uppercase transform, no heavy shadow, subtle
    scale-down (~96%) on press rather than a color-only active state.
*   Used on every page.

### `Card`
*   A `radius-xl` container with `--shadow-sm`, `--color-bg-surface`
    background, used as the base wrapper for list rows, the Dedup Review
    candidate pairs, and Budget/Bill entries.

### `Tile`
*   A `radius-lg` square-ish tile with a centered icon and a `text-label`
    caption below — matches NayaPay's in-app service-tile grid pattern.
    Used for any settings/action grid (e.g. a "more actions" grid on
    Dashboard or Capture Health linking to Budgets/Bills/Statement Upload).

### `StatDisplay`
*   The balance/amount display pattern from NayaPay's in-app mockup: a
    small `text-body` label line above, a large `text-balance` figure
    below, with an optional trailing icon slot (used for the hide/show
    toggle on Dashboard's total-spend figure, or a trend arrow on
    category breakdowns).

### `Pill` / `Badge`
*   `radius-pill` small label, used for category tags on transaction rows,
    the `review_status`/`dedup_resolution` state indicators on Transactions
    and Dedup Review, and status chips on Capture Health (e.g. "Connected,"
    "Needs reconnect").

### `EmptyState`
*   Icon/illustration slot + `text-body-lg` message + optional action
    button. Used wherever the design doc calls for explicit
    sparse/missing-coverage states (Dashboard trends, Transactions when
    empty, Budgets/Bills before any are configured).

### `Toast`
*   Transient notification matching the Notification Engine's in-app
    delivery (the design doc names email as primary and in-app as
    secondary) — `radius-lg`, `--shadow-md`, auto-dismiss, color-coded by
    `--color-success`/`--color-warning`/`--color-danger`.

### `Modal` / `Dialog`
*   `radius-xl`, `--shadow-md`, centered overlay on `--color-light-blackberry`
    scrim — used for the dedup-resolution confirmation and any destructive
    confirmations (discarding a transaction).

### `AppShell`
*   The one layout every page renders inside: a top bar (app name/mark —
    not NayaPay's — on the left, a settings/account icon on the right) and
    a left sidebar or top tab row for navigation between Dashboard,
    Transactions, Budgets, Bills, and Capture Health (desktop-width
    sidebar, collapsing to a bottom tab bar on narrow/mobile-browser
    widths, directly echoing NayaPay's own bottom-nav pattern).

## Page Layout Patterns

*   **Dashboard**: `StatDisplay` for total/period spend at the top, a
    `Tile` grid below for quick links (Log Missed Transaction, Budgets,
    Bills, Statement Upload), then the trends/breakdown charts, each
    wrapped in a `Card`.
*   **Transactions**: a list of `Card`-wrapped rows, each showing vendor,
    amount, a category `Pill`, and (when relevant) a `review_status` or
    `dedup_resolution` `Pill`.
*   **Dedup Review**: paired candidate transactions shown as two adjacent
    `Card`s with `keep`/`discard`/`confirm distinct` `Button`s, inside a
    `Modal` for single-item resolution or a dedicated page for the
    batch-resolution view.
*   **Log Missed Transaction**: a simple form using shared `Input`/
    `Button` components — deliberately the plainest page in the app,
    matching its "narrow, lightweight" status in the design doc.
*   **Budgets / Bills**: list of `Card` rows with `StatDisplay`-style
    progress (spent vs. limit) for budgets, due-date `Pill`s for bills.
*   **Capture Health**: status `Pill` (connected/degraded/needs reconnect)
    plus an `EmptyState`-style explanatory block when something's wrong,
    using the same named-failure-reason language from the main design
    doc's Goals.

## Responsive Behavior

*   **Breakpoints**: mobile (< 640px), tablet (640-1024px), desktop
    (> 1024px) — standard Tailwind defaults, no custom breakpoints needed.
*   `AppShell`'s navigation collapses from a sidebar (desktop/tablet) to a
    bottom tab bar (mobile), matching NayaPay's own mobile pattern.
*   `Tile` grids reflow from 3 columns (desktop) to 2 columns (mobile).
*   Forms (Log Missed Transaction, Statement Upload) are single-column at
    every breakpoint — no multi-column form layout at any width.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

This adds new frontend files to the existing plan in
`docs/designs/personal-spending-tracker.md`. **These should be merged into
that document's Target Files list** (inserted before item 37/Dashboard.tsx,
since every page component depends on them) so that document stays the
single source of truth for the full file list — noted as a follow-up
action at the end of this document rather than duplicated here as a
separate numbered list.

### New files

*   `frontend/src/styles/tokens.css` (Create) — defines all CSS custom
    properties from the Design Tokens section above.
*   `frontend/tailwind.config.js` (Create) — the Tailwind config from the
    Design Tokens section, extending the default theme.
*   `frontend/src/components/Button.tsx` (Create) — primary/secondary/danger
    variants.
*   `frontend/src/components/Card.tsx` (Create)
*   `frontend/src/components/Tile.tsx` (Create)
*   `frontend/src/components/StatDisplay.tsx` (Create)
*   `frontend/src/components/Pill.tsx` (Create)
*   `frontend/src/components/EmptyState.tsx` (Create)
*   `frontend/src/components/Toast.tsx` (Create), plus a lightweight
    `frontend/src/components/ToastProvider.tsx` (Create) for the
    show/dismiss context, since toasts need to be triggerable from any
    page.
*   `frontend/src/components/Modal.tsx` (Create)
*   `frontend/src/components/AppShell.tsx` (Create) — top bar + responsive
    nav (sidebar/bottom-tab-bar), wraps every routed page.
*   `frontend/src/components/index.ts` (Create) — barrel export for the
    above, so pages import from `components` rather than individual file
    paths.

### Verification

*   Each component gets a basic render test
    (`frontend/src/components/*.test.tsx`, using the same `vitest` already
    declared in the frontend's `package.json`) confirming it renders
    without error and applies the expected variant class/token.
*   A manual pass through all nine pages at mobile (375px), tablet
    (768px), and desktop (1280px) widths, checking the `AppShell`
    navigation collapses correctly and no `Tile` grid or form overflows —
    folded into the main design doc's existing `wrangler dev` E2E/CUJ pass
    rather than a separate verification step.

### Follow-up action

Once this document is reviewed, merge its new file list into
`docs/designs/personal-spending-tracker.md`'s Detailed Implementation Plan
(as new items before the current item 37, renumbering 37-48 upward
accordingly) so the two documents don't drift out of sync — keeping a
design-system doc and an implementation-plan doc that each claim a
different file list for the same codebase is a structural risk the same
way the earlier implementation-readiness review flagged for other gaps.

--------------------------------------------------------------------------------

*Drafted with reference to `docs/brand/nayapay-inspired-brand-guidelines.md`*
