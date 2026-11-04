# Handoff: Personal Spending Tracker — Design Phase

**Date:** 2026-11-02
**Repo:** `D:\projects\alfaaz` (not yet a git repository — no commits exist)
**Phase:** Design/planning complete through EGM review; zero application code written yet.

## What this project is

A personal spending-tracker web app for a single user (~100 tx/month),
built because a prior manual-tracking attempt failed (forgot to log,
tedious categorization). Captures NayaPay transactions via Gmail
(sender/subject query, not label-based) plus bank statement import
(PDF/CSV), with a narrow "log a missed transaction" fallback. Auto-
categorization, trends, budget alerts, bill reminders, and a Gmail-capture
health alert round out v1.

**Stack (decided, not yet implemented):** TypeScript on Cloudflare Workers
(Hono) + Cloudflare D1 (Drizzle ORM) backend; React (Vite) frontend on
Cloudflare Pages.

## Key artifacts (read these, don't ask the user to re-explain)

*   `concepts_brief.md` — full 5-round brainstorm history (EGM
    `egm-brainstorm`). All major product/scope decisions and their
    rationale live here. Don't re-litigate anything resolved in it.
*   `docs/designs/personal-spending-tracker.md` — **the primary design
    doc.** Architecture, full Target Files list (48 numbered files),
    Build Phases, Risks & Mitigations, Verification Plan. This went
    through the full EGM review pipeline (Stages 5-9): Zoom Out,
    Comprehension, Critic Review, Intermediate Zoom Out, Implementation
    Readiness — all findings from every stage were fixed in place. Treat
    this document as authoritative for file names, schema fields, and
    numbering.
*   `docs/brand/nayapay-inspired-brand-guidelines.md` — color/type/
    component research from NayaPay's live site (captured via
    `chrome-devtools-mcp`, exact values from their CSS custom properties,
    not estimated). **Contains a trademark note: do not use NayaPay's
    logo/wordmark as this app's own branding** — colors/type/patterns
    only.
*   `docs/designs/frontend-design-system.md` — **just created, not yet
    reviewed, not yet merged into the main design doc.** Defines design
    tokens (CSS custom properties + Tailwind config), a 10-component
    shared library (Button, Card, Tile, StatDisplay, Pill, EmptyState,
    Toast, Modal, AppShell, + barrel export), and per-page layout
    patterns. Adds 13 new frontend files not yet reflected in
    `personal-spending-tracker.md`'s numbered Target Files list.
*   `AGENT_SKILLS.md` — manifest of installed skills/plugins for this
    project (see below); point any future agent at this file instead of
    re-explaining installs.
*   Stage review artifacts in the repo root (`zoom_out_report.md`,
    `comprehension_report.md`, `critic_report.md`,
    `implementation_readiness_report.md`, `goldfish_review_report.md`) —
    historical record of the EGM review rounds; current state is already
    folded into the main design doc, these are not action items.
*   `.research/` — NayaPay site screenshots used for the brand guidelines.

## Immediate open item (was mid-decision when this handoff was triggered)

The user was just asked: merge `frontend-design-system.md`'s 13 new files
into `personal-spending-tracker.md`'s Target Files list (inserting before
current item 37, renumbering 37→48 upward), or keep the two documents
separate? **No answer given yet** — ask the user this directly before
assuming either path.

## Other genuinely open items

*   **Bank statement formats** (Open Question in the main design doc,
    Build Phases "Phase 4"): the user's actual bank list and statement
    layouts are still unknown. This blocks `statementAdapter.ts`'s
    PDF/bank-profile path specifically — CSV parsing and everything else
    is not blocked by it.
*   Several smaller Open Questions remain in the main design doc
    (category taxonomy, budget period definition, email provider is now
    decided as Resend but API key/account isn't set up, OAuth token
    lifecycle details, data retention policy) — listed in full there,
    not blocking implementation start per the Build Phases sequencing.

## Tooling/environment notes

*   `chrome-devtools-mcp` is installed (user-scoped MCP server via
    `claude mcp add`) and works — used successfully for the brand
    research. Available for any future UI verification/visual work.
*   EGM (`google/elephant-goldfish-model`) plugin is installed.
    **Important:** its skills (`egm-brainstorm`, `egm-draft`, `egm-review`,
    etc.) have `disable-model-invocation: true` — a future agent must
    **not** try to call them via the `Skill` tool. They only run when the
    *user* types the slash command (`/egm:egm-review`, etc.). If more
    design iteration is needed, tell the user which command to run rather
    than attempting it yourself.
*   `superpowers`, `i-have-adhd`, and `emilkowalski/skills` (animation/
    design-eng skills) are also installed per `AGENT_SKILLS.md`.
*   No git repository exists yet in this project.

## Suggested skills for the next session

*   If the user wants to resume design-doc iteration: tell them to run
    `/egm:egm-review docs/designs/frontend-design-system.md` (it hasn't
    been reviewed yet) rather than invoking it yourself.
*   If implementation is starting: call the `superpowers:writing-plans`
    skill before touching code (there's a spec, but no task breakdown
    yet), then `superpowers:test-driven-development` once coding starts,
    and `superpowers:using-git-worktrees` since no git repo exists yet
    and one should probably be initialized cleanly.
*   If building the Dashboard/trends charts specifically: call the
    `dataviz` skill before writing any chart code.
*   Before any commit/PR that touches `security.ts` (OAuth token
    encryption) or the Gmail OAuth flow: call `security-review`.
*   Do not call `anthropic-skills:built-in-browser` or
    `anthropic-skills:chrome-browser` for further site inspection —
    `chrome-devtools-mcp` is already installed and was used instead; no
    need to switch tools.
