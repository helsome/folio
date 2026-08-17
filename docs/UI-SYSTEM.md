# Folio UI System

Folio is a quiet financial workspace: dense enough for live market work, but
calm enough to keep the user's attention on a decision. This document is the
small contract for new UI work in the renderer.

## Foundations

- Use the token layer in `apps/electron/src/renderer/styles/index.css`.
- Prefer opaque surfaces (`bg-background`, `bg-surface`, `bg-surface-muted`)
  over blur, gradients, and translucent glass.
- Use 8–10px control radii, 10–12px panel radii, and a 1px `border-border`.
- Use `text-foreground`, `text-foreground/52`, and `text-foreground/38` for
  primary, secondary, and quiet text. Do not invent page-specific grays.
- Use `text-positive`, `text-negative`, `text-warning`, and `text-info` only
  for data meaning or status—not decoration.
- Numeric values use `tnum`/tabular numerals. Prices and percentages must
  degrade to an em dash rather than `NaN`, `undefined`, or an empty label.

The compatibility `mac-*` classes remain for existing screens, but map to the
same quiet token surfaces. New components should use the semantic tokens
directly.

## Component rules

Use the shared primitives before adding a one-off control:

- `Button`, `Input`, `Dialog` for actions and forms.
- Radix-backed `Tabs`, `Select`, `DropdownMenu`, `Tooltip`, and `Switch` for
  keyboard behavior and accessible roles.
- `EmptyState`, `ErrorState`, `StatusDot`, and `Skeleton` for honest states.
- Lucide icons at 14–18px for controls; icon-only controls require an
  accessible label and a tooltip when the meaning is not obvious.
- Sonner is the global transient-feedback channel. Keep important errors
  inline near the failed operation as well.

Avoid adding a card only to group a heading. Prefer a section divider or a
compact table row. Cards are reserved for a meaningful object, a decision
surface, or a high-signal summary.

## Workbench shell

The shell has three stable regions:

1. A 64px global icon rail for Today, Discover, Workspace, Portfolio,
   Compare, Alerts, and Settings.
2. A contextual secondary panel for sessions, watchlist, research navigation,
   or settings navigation.
3. The finance workspace plus an optional resizable Agent Panel, with
   Allotment remaining the source of truth for pane sizing.

The active security is stored in `activeSymbolAtom`; views, the SecurityHeader,
chart, and Agent context must read it rather than maintaining local copies.
Workspace context is exposed through the existing `WorkspaceContext` atom and
should be included in agent requests and visible as a context chip.

## Page patterns

### Today

Use one hero/search surface, three high-signal quick actions, then quiet
sections for Daily Brief, Market Pulse, and portfolio/watchlist attention. A
section should expose its loading, empty, or error state without pretending
that unavailable data is zero.

### Discover

Task families use compact, scannable rows. Results use a table-like header and
one row per candidate with score, key metrics, and icon actions for research,
compare, and watchlist.

### Security workspace

Keep the SecurityHeader above the Overview/Chart/Financials/News tab strip.
The chart owns the active symbol and period controls; data freshness belongs
next to the source, not in a detached global banner.

### Agent Panel

Keep model and thinking-level controls at the top. Show the workspace context
chip, compact turn history, and tool activity as a collapsible progress row.
Structured quote, portfolio, and research outputs should be readable as
decision objects, not chat bubbles. A run must expose a stop action while
active and a useful empty state before the first message.

### Settings

Use a two-level structure: contextual navigation in the left panel and Radix
tabs in the content area. General includes the Light/Dark/System theme
selector. Provider/API credentials belong in Connections or Models and are
never rendered as plaintext after save.

## State contract

Every data-backed surface follows this order:

- Loading: use a small skeleton or one quiet `Loading…` line.
- Success: render the data with source and freshness where relevant.
- Empty: say what is missing and what action can populate it.
- Error: explain the user-safe failure and provide retry or configuration.
- Partial: show available data and identify unavailable capability families.

Never fabricate a timestamp, quote, valuation, portfolio total, or agent
answer. Keep raw provider errors out of renderer copy.

## Visual QA

The visual harness captures the golden states at the requested dimensions:

```sh
cd apps/electron
node e2e/visual.mjs
```

Inspect the output in `apps/electron/e2e/artifacts/ui/`. The required smoke
checks are:

```sh
bun test
bun run typecheck
bun run build
FINAGENT_AGENT_PROVIDER=local bun run test:e2e
```

Before shipping a new page, check 1440×900, 1280×800, and a larger viewport
for overflow, clipped focus rings, unreadable muted text, and a rail/secondary
panel that collapses before the finance workspace becomes unusable.
