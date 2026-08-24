# Folio V10.1 — Ambient Motion & Agent State Polish

## Scope and baseline

The existing Electron renderer already has a dense financial workspace: a persistent left rail, Today/Discover views, the Research market workspace with chart/evidence/Decision Rail surfaces, and a right-side Agent panel. The implementation keeps those information surfaces, financial values, charts, tables, Trace, Evaluation, Portfolio, Compare, and Settings static.

The motion layer is intentionally state-driven and decorative:

- `AgentAmbientField` is a bounded CSS/DOM particle field with deterministic positions.
- `SubtleDotField` is a bounded dot-grid scan for an active Discover run.
- `ContentReveal` provides one whole-region reveal when content becomes available.
- `useMotionVisibility` pauses fields when the document is hidden or the field is outside the viewport.
- `usePrefersReducedMotion` mirrors the system preference into a component attribute; CSS removes animation and transition motion when reduced motion is requested.

All decorative layers use `pointer-events: none`, `aria-hidden`, containment, and no React render loop.

## React Bits study and decision

I reviewed the official Particles, Threads, and Dot Grid references and source implementations:

- [Particles](https://reactbits.dev/backgrounds/particles) uses an OGL renderer, a requestAnimationFrame loop, and a configurable particle population.
- [Threads](https://reactbits.dev/backgrounds/threads) uses OGL shaders and includes visibility/page-hidden pausing and cleanup.
- [Dot Grid](https://reactbits.dev/backgrounds/dot-grid) uses GSAP/Inertia-style pointer interaction and a much richer interaction surface.

For Folio, the visual language was adapted rather than adding OGL, GSAP, WebGL, or a new runtime dependency. A low-density CSS/DOM implementation is easier to pause, more predictable in an Electron financial UI, and avoids introducing a GPU-heavy canvas behind functional content.

## Experiments

### A — Research sparse particles

Implemented. A capped 28-point default field sits only behind the Decision Rail while a real Research run is active. `tool` and `synthesizing` use different restrained activity levels; idle, error, and an unmounted completed run are static. Keep.

### B — Threads-like synthesis layer

The shader/thread reference was evaluated, but a second animated shader layer would have made the Decision Rail read as a separate “machine” and increased runtime cost. Synthesis therefore reuses the same sparse field with a coherent radial halo and stronger opacity, preserving the state distinction without adding another ambient system. Keep this simplified treatment.

### C — Discover dot field

Implemented. A capped 48-dot grid appears only inside the running Discover surface, with no pointer attraction or hover effects. Results use a single whole-results reveal; table rows, values, and sorting remain static. Keep.

## Final motion mapping

| Surface/state | Treatment |
| --- | --- |
| Today / static workspace | Static |
| Discover browse | Static |
| Discover running | Subtle dot field behind the running content |
| Discover results | Whole-results content reveal; table remains static |
| Research idle | Static |
| Research tool/data gathering | Sparse particles behind Decision Rail |
| Research synthesis | Same field with restrained halo/activity change |
| Research complete / partial / error | Settles to static or unmounts; no data animation |
| Agent active run | Ambient field behind the existing real run/tool activity |
| Agent idle / completed | Static |
| Portfolio / Compare / Trace / Evaluation / Settings | Static |

The Agent field derives from the existing `runView` and tool-call state. It does not create fake progress or an independent machine state.

## Accessibility and performance safeguards

- Reduced motion is supported through both `prefers-reduced-motion` CSS and the component media-query hook.
- Decorative regions are `aria-hidden`; the semantic “running”/“working” text remains in the existing UI.
- Fields are capped, deterministic, and DOM/CSS-only. No WebGL, canvas, GSAP, or heavy dependency was added.
- IntersectionObserver and `visibilitychange` pause ambient animation when hidden or offscreen.
- `pointer-events: none`, `contain: layout paint`, and absolute local layering keep the fields from affecting interaction or layout.
- No financial data, charts, K-lines, tables, or evidence values are animated.

## Visual QA artifacts

Before captures:

- [workspace](./before/workspace.png)
- [today](./before/today.png)
- [discover browse](./before/discover-browse.png)
- [settings dark](./before/settings-dark.png)

After captures:

- [Electron workspace](./after/electron-workspace.png)
- [Electron Today](./after/electron-today.png)
- [Electron Discover browse](./after/electron-discover-browse.png)
- [light Today](./after/today.png)
- [dark Today](./after/today-dark-fixed.png)
- [dark Discover](./after/discover-dark-fixed.png)
- [Research idle](./after/research-idle.png)
- [Research running attempt](./after/research-running.png)
- [Discover running attempt](./after/discover-running.png)
- [Discover results fallback](./after/discover-results.png)

Light and dark static surfaces were inspected. The final dark captures include a narrow token/contrast correction for legacy light-first surface overrides; geometry and information hierarchy were left unchanged.

The local fallback environment did not provide a live market-data/agent provider, so the Research-running, Discover-running, and true-results files document the attempted states rather than pretending to be successful provider-backed captures. The component tests and existing Discover flow tests cover the state transitions, and the real Electron harness verified the production renderer loads.

## Verification

Passing checks:

```text
bun test packages/ui/src/components/motion/motion.test.tsx --isolate
bun test packages/ui/src/components/discover/DiscoverView.test.tsx --isolate
bun run --filter @finagent/ui typecheck
bun run i18n:check
bun run eval:smoke
bun run build
bun run test:package-smoke
```

The Discover suite passes all 12 tests; its existing React `act(...)` warnings remain non-failing. The evaluation smoke passes 15/15 deterministic cases. Production build and packaged-app smoke both pass.

The full repository suite currently reports 1,141 passing tests and 7 unrelated LongBridge failures because the checkout lacks the `positions`, `assets`, `cash-flow`, and `portfolio` fixtures and the LongBridge CLI is unavailable. The repository `lint` script also has a pre-existing workspace-filter mismatch. The legacy `test:e2e` runner is onboarding-state sensitive and was stopped after repeated overlay-intercepted clicks; the production packaged-app smoke is green.
