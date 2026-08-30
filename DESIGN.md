# Design system

The NGIAB visualizer is a **product** surface: a map and chart view over model output. Design
serves the task. The bar is earned familiarity, not novelty, and the tool should disappear into
the work of reading a hydrograph.

Every colour lives in `tethysapp/ngiab/public/frontend/styles/tokens.css`. Nothing in the app
uses a colour literal.

## Register and scene

An analyst comparing a NextGen run against USGS observations, on a desktop monitor, in an office
during the day, checking whether a catchment behaved sensibly. That sentence sets the default
theme to **light** and makes dark an explicit choice, not a mood. Dark is offered because the
same person looks at flood response at 2am; it is a toggle, and it also follows
`prefers-color-scheme` when the user has not chosen.

## Colour

**Strategy: Restrained.** Tinted neutrals carry every surface. One accent marks primary action,
current selection and state. Colour is never decoration here, because the map is already
carrying data-driven colour and the panels must not compete with it.

All neutrals are tinted toward the brand hue (**250**, blue). Pure grey next to a blue-heavy
basemap reads as dead chrome.

| Token | Role |
|---|---|
| `--bg` | Page and chart ground |
| `--surface` | Panel cards, popovers |
| `--surface-sunken` | Inputs, hover fills |
| `--fg` / `--fg-muted` / `--fg-subtle` | Text, three levels |
| `--border` / `--border-strong` | Hairlines, control outlines |
| `--accent` | Primary action, selection, focus ring |
| `--danger` / `--warning` | Status severities only |
| `--selection` | The selected catchment on the map |

**Contrast is solved, not chosen.** Every text role is measured against `--surface`, the
panel ground it is actually drawn on, and held at or above the 4.5:1 AA floor. The numbers
below were measured, not asserted -- an earlier version of this table listed four roles,
omitted `--fg-subtle`, and claimed 5:1 for all of them while `--fg-subtle` sat at 4.13:1 on
the smallest text in the interface. Nothing recomputes them now, so treat them as a record of
one measurement rather than a live guarantee, and re-measure when you change a colour: the
dark roles sit within 0.05 of the floor.

| Role | Light | Dark |
|---|---|---|
| `--fg` | 16.42:1 | 13.81:1 |
| `--fg-muted` | 6.43:1 | 7.56:1 |
| `--fg-subtle` | 5.00:1 | 5.22:1 |
| `--accent` | 5.07:1 | 4.54:1 |
| `--danger` | 5.08:1 | 4.53:1 |
| `--warning` | 5.07:1 | 4.55:1 |

Re-solve with the OKLCH solver in that script rather than nudging values by eye.

`--selection` sits at hue 25, deliberately warm, so it can never be mistaken for a step in the
blue choropleth ramp.

The map's own ramp is separate, in `lib/choropleth.js`: a sequential blue scale with a distinct
dark variant, and bin `0` reserved for no-data as fully transparent.

## Typography

One family, the system stack. Product UI does not need display pairing, and a native stack means
the panels look local on every platform.

Fixed rem/px steps, not fluid: users view at a consistent DPI, and a sidebar heading that shrinks
with the viewport looks worse, not better. Sizes run 11px (legend ends, notes), 12px (labels,
metrics), 13px (body, controls). Weight carries hierarchy more than size does, because the panels
are small and a large step would shout.

`font-variant-numeric: tabular-nums` on every number that can change: timestamps, metrics, legend
breaks, catchment ids. Digits must not reflow while a timeline plays.

## Layout

- Two cards in the control stack, not one per concern. Run and search answer "which data";
  shading and layers answer "how it is drawn". Sections inside a card are divided by a hairline.
- The stack is bounded top and bottom and scrolls inside the map, so it can never overlap the
  chart below.
- Cards are used because these are genuinely floating panels over a map. They are not the default
  answer elsewhere, and they are never nested.

## Controls

`--tap-min` is **44px**, applied as `min-height` to every control. WCAG 2.5.8 sets the floor at
24px; 44px is the comfortable target. Checkbox rows put the tap area on the whole label, so the
18px box is never the hit target.

Every interactive element has default, hover, focus, active and disabled. The focus ring is one
rule in `app.css` on `:focus-visible`, so it never depends on the UA default.

## Motion

`--dur-fast` 120ms, `--dur` 180ms, `--ease-out` a quart curve. Motion conveys state only: hover
feedback, the busy spinner, the chart fading while loading. Only `opacity` and `transform` are
ever animated. `prefers-reduced-motion: reduce` drops every transition to 1ms and stops the
spinner.

No page-load choreography. The app loads into a task.

## Responsive

Structural, not fluid. Below **820px** the control stack becomes a bottom sheet and the map
canvas is *shortened* rather than covered, so MapLibre's attribution stays visible, which is a
licence requirement. 820px rather than 640px because a 300px overlay on a 768px tablet leaves too
little map to read.

## Accessibility

- Heading outline via `.sr-only`, so screen readers get structure without changing the visuals.
- `<main>` and `<section>` landmarks, each labelled.
- `role="status"` on every async region: map status, chart status, search-empty, run status.
- The map is `role="application"` with a label; keyboard users reach every function through the
  panels rather than the canvas.

## Bans

No gradient text, no glassmorphism, no side-stripe borders, no modals, no bounce easing, no
nested cards, no colour literals outside `tokens.css`, no `#fff` or `#000`.
