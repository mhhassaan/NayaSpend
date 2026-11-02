# Brand & UI Guidelines — NayaPay-Inspired

*   **Author:** mh.hassaan03@gmail.com
*   **Status:** Draft
*   **Date:** 2026-11-02
*   **Source:** Reverse-engineered from the public NayaPay marketing site
    (`nayapay.com`) — exact CSS custom properties, computed styles, and
    screenshots captured via `chrome-devtools-mcp` on 2026-11-02.

--------------------------------------------------------------------------------

## Important: trademark/affiliation note

This document captures NayaPay's **visual style** (colors, type, spacing,
component patterns) so the spending tracker app can feel visually coherent
with the NayaPay app it reads transaction emails from. It is **not** a
license to use NayaPay's actual brand assets.

*   **Do not use NayaPay's logo, wordmark, or the word "NayaPay" as the
    spending tracker's own app name/logo.** This app is an independent
    personal tool, not affiliated with or endorsed by NayaPay. Using their
    logo or name as our own branding would misleadingly imply affiliation.
*   It's fine to reference "NayaPay" in UI copy *functionally* (e.g. "Connect
    your NayaPay Gmail account," "NayaPay transactions") since the app
    genuinely integrates with NayaPay's email notifications — that's a
    factual description, not a branding claim.
*   Colors, type choices, and layout patterns below are generic design
    decisions (an orange/burgundy palette, Poppins/DM Sans, rounded cards)
    inspired by what NayaPay does well for a finance app — not copyrighted
    in the way a logo is — but if this app is ever published publicly,
    get the overall look reviewed so it reads as "inspired by," not "a copy
    of," NayaPay's app.

--------------------------------------------------------------------------------

## 1. Color Palette

All values below are NayaPay's own CSS custom properties, confirmed against
rendered elements (not estimated from pixels).

### Core neutrals

| Token | Hex | Usage on NayaPay's site |
|---|---|---|
| `dark-blackberry` | `#1e141e` | Deepest background (hero section base) |
| `blackberry` | `#381d2a` | Primary dark — heading text, dark button backgrounds, dark card backgrounds |
| `hyper-white` | `#fcf9fb` | Near-white — text on dark backgrounds, light button backgrounds |
| `silver-frost` | `#f0eaed` | Light neutral background (section backgrounds) |
| `deep-grey` | `#8c8085` | Muted secondary text |
| `mid-grey` | `#d9d2d5` | Borders, dividers, disabled states |
| `lightest-grey` | `#ddcbd1` | Subtle fills |

### Brand accents

| Token | Hex | Usage |
|---|---|---|
| `electric-orange` | `#ff5018` | **Primary brand color.** Logo mark, headline text, primary CTA accents, active nav-bar icon state |
| `hot-red` | `#c71e06` | Secondary accent — used sparingly (one feature-card background) |
| `deep-violet` | `#9048c4` | Tertiary accent |
| `vivid-violet` | `#c4b8ff` | Light purple accent (feature-card background, category labels) |
| `light-purple` | `#ece8fd` | Very light purple tint (card backgrounds) |
| `bubblegum` | `#ffc6d4` | Pink accent (feature-card background) |

### Opacity variants (for overlays/tints)

| Token | Value |
|---|---|
| `light-blackberry` | `#1e141e33` (blackberry at 20% opacity) |
| `silver-frost-light` | `#f0eaed4d` (silver-frost at ~30% opacity) |
| `hyperwhite-50` | `#fcf9fb99` (hyper-white at ~60% opacity) |

### Color usage principles observed

*   **One saturated accent color per surface.** Each marketing feature card
    uses exactly one accent (red, purple, orange, dark, or neutral) as its
    full background — accents are never mixed on the same card.
    Electric-orange is reserved as *the* signature color (logo, hero
    headline, primary active states) and isn't diluted by overuse elsewhere.
*   **Dark-on-light and light-on-dark, not grey-on-grey.** Text pairs are
    almost always `blackberry` on `hyper-white`/`silver-frost`, or
    `hyper-white` on `blackberry`/`dark-blackberry` — high-contrast pairs,
    not mid-tone-on-mid-tone.
*   **Muted secondary text uses `deep-grey`, never a lighter tint of the
    body color** — this keeps secondary text legible rather than looking
    like a disabled/greyed-out accessibility issue.

### Suggested Tailwind config mapping

```js
// tailwind.config.js (excerpt)
colors: {
  'dark-blackberry': '#1e141e',
  blackberry: '#381d2a',
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
}
```

--------------------------------------------------------------------------------

## 2. Typography

### Font families

| Role | Family | Weights in use | Fallback |
|---|---|---|---|
| **Display/Headings** | Poppins | 400, 600, 700, 800, 900 | Verdana, sans-serif |
| **Body/UI** | DM Sans | 300, 400, 500, 600, 700, 800, 900 | sans-serif |

Both are freely available on Google Fonts. Load via:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800;900&family=DM+Sans:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
```

### Type scale (as measured on the live site)

| Element | Font | Size | Weight | Notes |
|---|---|---|---|---|
| Hero H1 | Poppins | 80px | 900 | ALL CAPS, `electric-orange`, tight line-height |
| H2 | Poppins | 70px | 900 (bold display weight) | Section headlines |
| Body / secondary text | DM Sans | 18px | 400-600 | |
| Button label | DM Sans | 15px | 600-700 | Slight negative letter-spacing on light buttons (`-0.42px`) |
| Nav link | DM Sans | 16px | 500 | |

### Usage rules

*   **Poppins is for big, bold, short statements** — headlines, hero copy,
    section titles. Always heavy weight (700-900), often set in title case
    or ALL CAPS for maximum impact. Not used for paragraphs or UI chrome.
*   **DM Sans is for everything functional** — body copy, buttons, nav,
    form labels, in-app UI text (the dashboard mockup's balance figure,
    tile labels, and search placeholder are all DM Sans).
*   In the in-app UI specifically (not the marketing site), DM Sans carries
    more weight than Poppins does — large numbers like the account balance
    use a bold DM Sans rather than switching to Poppins, keeping the app
    interface calmer than the marketing site's shouty headlines.

--------------------------------------------------------------------------------

## 3. Spacing, Radius & Shape

| Token | Value | Usage |
|---|---|---|
| `card-gap` | 20px | Gap between cards in a row/grid |
| `card-width` | 300px | Marketing feature-card width |
| `nav-btn-size` | 48px | Circular icon-button diameter |

### Observed corner radii

| Component | Radius |
|---|---|
| Primary buttons (dark) | 10px |
| Secondary buttons (light) | 8px |
| Phone mockup frame | ~32-40px (large, device-like rounding) |
| In-app service tiles | ~16-20px (soft rounded squares) |
| In-app search bar / pill inputs | Full pill (9999px) |
| Marketing feature cards | ~16-24px |

**Principle:** generous, consistent rounding throughout — nothing in the
interface uses sharp (0px) corners except the very outer page edge. Larger
containers (phone frame, cards) round more; small interactive elements
(buttons, chips) round less but are never sharp.

--------------------------------------------------------------------------------

## 4. Buttons

### Primary (dark) button

Used for the main call-to-action ("Let's NayaPay", "Download the App").

```css
background: #381d2a;      /* blackberry */
color: #fcf9fb;            /* hyper-white */
border: 1px solid #381d2a;
border-radius: 10px;
font-family: 'DM Sans', sans-serif;
font-weight: 700;
font-size: 15px;
padding: 20px 60px;
```

### Secondary (light) button

Used on dark backgrounds, e.g. the header's "Get Started" button over the
dark hero section.

```css
background: #fcf9fb;      /* hyper-white */
color: #381d2a;            /* blackberry */
border-radius: 8px;
font-family: 'DM Sans', sans-serif;
font-weight: 600;
font-size: 15px;
letter-spacing: -0.42px;
padding: 14px 50px;
```

### Rules

*   No uppercase text-transform on buttons — sentence case throughout
    ("Get Started," not "GET STARTED").
*   No heavy drop shadows — flat fills with the occasional subtle hover
    scale (`--active-scale: 1.08` suggests a ~8% scale-up on hover/press
    for interactive cards).
*   Button padding is generous and roughly 2.5-3x the font size vertically
    — buttons read as substantial tap targets, appropriate for a
    finance app where mis-taps matter.

--------------------------------------------------------------------------------

## 5. In-App UI Patterns (most relevant reference for this project)

The marketing site embeds a mockup of NayaPay's actual app dashboard —
this is the most directly transferable reference for the spending
tracker's own screens, since it's a real finance-app UI, not marketing
copy.

### Dashboard header pattern

*   Circular avatar (user initials on a tinted-purple background) — top left.
*   Pill-shaped search bar with a leading search icon and grey placeholder
    text — center, flexible width.
*   Two circular icon buttons (utility action, notification bell) — top
    right, dark/filled icon on a light or dark circular background.

### Balance display pattern

*   Small greeting line above ("Hi [Name] 👋") in regular-weight DM Sans.
*   Large, bold balance figure directly below, with a currency prefix
    ("Rs.") and an eye/hide icon beside it to toggle visibility — directly
    applicable to a spending tracker's own balance/spend summary header.

### Quick actions row

*   3 circular icon buttons in a row, each with a label underneath
    (Add Money / Send Money / More) — a clean pattern for a tracker's own
    primary actions (e.g. Log Transaction / View Trends / Settings).

### Service tile grid

*   2-row, 3-column grid of rounded-square tiles on a light (`silver-frost`
    or white) background, each tile showing a small colored icon/illustration
    above a short label (QuickPay, Bills, Merchants, Mobile Top Up, Bill
    Split, Gift Envelope).
*   Icons are small, soft-colored illustrations (not flat monochrome
    glyphs) — they carry a bit of the orange/warm palette even on a neutral
    tile background, keeping the grid visually tied to the brand without
    every tile being full-color.
*   This maps well onto a settings/actions grid (e.g. Statements / Budgets
    / Bills / Trends / Capture Health / Log Missed Transaction).

### Bottom navigation

*   Icon-only tab bar, 4 items, with the active tab highlighted in
    `electric-orange` (the brand mark's own color) against otherwise
    neutral grey icons — a clear, minimal way to signal the active section.

--------------------------------------------------------------------------------

## 6. Marketing/Illustration Card Pattern

Useful if this app ever needs onboarding screens, empty states, or
promotional/explainer cards:

*   Full-bleed colored background (one accent color per card — never
    mixed).
*   Small category label in a lighter/tinted version of a contrasting
    color near the top.
*   2-3 line bold statement below the label, left-aligned, using a mix of
    regular and bold weight within the same block to emphasize key words.
*   A simple, slightly 3D-rendered or stylized illustration anchored at
    the bottom of the card, related to the card's theme.
*   Cards scroll horizontally with round, outlined prev/next arrow buttons
    below the row.

--------------------------------------------------------------------------------

## 7. Voice & Tone

NayaPay's copy is playful, confident, and a little irreverent — short
punchy sentences, wordplay, and light humor, while still being clear about
what each feature does. Examples captured from the site:

*   "MAKE MONEY THINGS HAPPEN" (hero headline)
*   "Everyday spends, big plans and the little moments in between. If it's
    money, you can do it here."
*   "The speed for needs. A moneyfesto."
*   "Sign up quicker than you can say 'signed up'."
*   "Free to join. Free to stay. What a concept."
*   "You're welcome, I guess 😏" (a mock chat bubble in a card illustration)

**For this app**, a toned-down version of this voice fits well for
notification copy and empty states (e.g. a budget alert, a "no spending
this week" empty state) — confident and a little warm, not corporate or
robotic, but without overdoing the jokes in places where clarity matters
most (error messages, security/reconnect prompts should stay plain and
direct, per the design doc's own "name the specific failure reason" Goal).

--------------------------------------------------------------------------------

## 8. Accessibility Notes

A few combinations from the palette need a contrast check before reuse in
functional UI (not just decorative marketing cards):

*   `vivid-violet` (`#c4b8ff`) on `silver-frost` (`#f0eaed`) is a light-on-light
    pairing — fine for a decorative card background with dark text on top,
    but should not be used as text-on-background by itself.
*   `deep-grey` (`#8c8085`) on `hyper-white`/`silver-frost` should be
    spot-checked against WCAG AA (4.5:1 for body text) before using it for
    anything beyond short secondary labels — it reads fine for a line of
    muted helper text but isn't your primary-text contrast ratio.
*   Stick to `blackberry`/`dark-blackberry` on light backgrounds, and
    `hyper-white` on dark backgrounds, for any text carrying real
    information (balances, alerts, form labels).

--------------------------------------------------------------------------------

## 9. Quick Reference Summary

```
Fonts:      Poppins (headings, 700-900) + DM Sans (everything else, 400-700)
Primary:    #ff5018  electric-orange
Dark:       #381d2a  blackberry   /  #1e141e  dark-blackberry
Light bg:   #f0eaed  silver-frost /  #fcf9fb  hyper-white
Accents:    #c71e06 hot-red · #9048c4 deep-violet · #c4b8ff vivid-violet
            · #ece8fd light-purple · #ffc6d4 bubblegum
Radius:     10px (buttons) · 16-24px (cards) · full pill (inputs/search)
Buttons:    Sentence case, generous padding, no shadows, subtle hover scale
```
