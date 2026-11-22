# Jarvis UI style guide

Read this first when you build a Jarvis surface. The code and [DESIGN.md](../../DESIGN.md) stay authoritative.
The [UI reference index](README.md) lists designs that still need work.

Evidence labels: **Token** = a value read from code, with its file. **Decision** = agreed in `DESIGN.md` or
`docs/decisions.md`, no token. **Suggestion** = this guide's advice for a new platform, not yet agreed.

## 1. Principles

- **Dark, calm and quiet.** A near-black navy page, a sparse cyan network, and one bright thing: the orb.
- **The orb is the identity.** Dark glass sphere, cyan edge, amber heart. Nothing else competes with it.
- **Glass is neutral.** Controls are dark smoked glass. Colour is small: amber text, cyan states, a few semantic hues.
- **Show real state.** Every state is honest: working, empty, failed, offline. No invented numbers.
- **Motion has a job.** It shows what Jarvis is doing, and it stops when nobody is watching.
- **One source per look.** Change a shared token or component, never a screen.

## 2. Colour

Dark is the primary look. Every role has a light twin. Source for web values: `apps/web/src/styles.css`
(`:root` is light, `:root[data-theme="dark"]` overrides it).

| Role | Dark | Light | Source |
| --- | --- | --- | --- |
| Page (web) | `#07090f` | `#f6f0e6` | `--page` |
| Page under the neural network | `#02070f` | `#f6f0e6` | `neuralBackground`, `JarvisDesignSystem.swift` |
| Surface | `rgb(16 23 33 / 90%)` | `#fffaf1` | `--surface` |
| Translucent surface (text over glass) | `rgb(9 16 23 / 90%)` | `rgb(240 245 247 / 92%)` | `--surface-translucent` |
| Text | `#f3fff9` | `#17202a` | `--text` |
| Muted text | `#c0ccd2` | `#5c564f` | `--text-muted` |
| Stone (quiet secondary accent) | `#c9bfae` | `#6f6551` | `--secondary-accent` |
| Structure line | stone at 18% | stone at 24% | `--rule` |
| Control boundary | `#74878a` | `#65747a` | `--control-rule` |
| Accent orange (primary) | `#ffb45c` | `#b45f06` | `--primary-action` |
| Text on orange | `#1d1200` | `#ffffff` | `--primary-action-text` |
| Focus ring | `#ffb45c` | `#a65300` | `--focus` |

Orb palette (**Token**, `apps/web/src/jarvis-orb-appearance.ts`, mirrored by `JarvisOrbAppearance` in JarvisCore):
cool `#52dcfa`, deep `#247af2`, warm `#ffa62e`, hot `#ffbd4a`. The core is amber and never white-hot.

Semantic colours (**Token**, `styles.css`):

| Meaning | Dark | Light |
| --- | --- | --- |
| Listening (cyan) | `--state-listening` `#52dcfa` | `#14768d` |
| Thinking, speaking, reconnecting (amber) | `--state-thinking` `#ffb45c` | `#8a5a1c` |
| Unavailable | `--state-unavailable` `#ff8791` | `#a4262c` |
| Success | `--success` `#a8eefc` | `#14697e` |
| Warning | `--warning` `#ffc27a` | `#835000` |
| Error | `--error` `#ff9690` | `#951f25` |
| Presence: present / away / on the move | `#3ddc84` / `#ffd23f` / `#3b8bff` | `#2db35d` / `#f2c200` / `#2f80ed` |

- **Decision:** cyan = listening, edge of the glass. Amber = Jarvis working, speaking, attention. Red = errors only.
  Orange is a small accent: text, strokes, soft tints. Presence keeps green, yellow and blue.
- **Decision:** light mode keeps the same states and layout. The page is warm cream, the network lines are deeper teal.
- The web supports a per-user `--theme-accent` override; defaults above apply otherwise.

## 3. Glass and surfaces

- **Decision (owner-approved Notes direction, 15 Nov):** every action button is **neutral dark smoked
  glass**. No yellow, orange or gold fill, no warm gradient. Primary labels (Save, Done, Retry) are **amber text**;
  secondary labels are neutral; disabled labels are muted. Orange survives only on task rings, with a label.
- **Decision (31 Oct):** no solid orange fills anywhere; large orange areas are too harsh. In chat only the user bubble
  has a background (a soft orange-tinted glass pill, 16% accent tint). Jarvis replies and status lines are unboxed text.
- Glass fill (**Token**, `glassFill`, `JarvisDesignSystem.swift`): dark `rgba(16,22,30,0.36)`, light `rgba(255,255,255,0.44)`.
  Solid fallback for Reduce Transparency (`glassSolid`): dark `#161c24`, light `#efe8dc`.
- Web glass (**Token**): `--surface-blur` 24px dark / 16px light, `--chrome-glass-blur` 10px, `--readability-glass-blur` 16px,
  `--glass-hover` 9% and `--glass-pressed` 14% of `--text`, `--glass-rim-light` `rgb(255 255 255 / 34%)` dark.
- **Rule:** text sits on `--surface-translucent`, never on raw blur, so contrast stays stable over the moving background.
- **Suggestion (Windows):** build the fill with `backdrop-filter: blur()` plus the fill above. Do not use bright
  Mica or Acrylic tints; the result must stay neutral and dark.
- Borders are structure only (`--rule`, `--control-rule`). Selection is a whole lit surface, never an edge.

## 4. Typography and spacing

- **Token:** body font `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` (`--font-body`; headings
  use the same). Mono: `ui-monospace, SFMono-Regular, Consolas, monospace`. On Windows this resolves to Segoe UI.
- **Token:** caption 13px, small 14px, body 16px, subsection 17px, lead 18px, subheading 22px, title
  `clamp(28px, 4vw, 40px)`. Line heights: body 1.55, prose 1.45, heading 1.3, tight 1.2.
- **Decision:** page titles are bold, left-aligned, about 32pt on iOS (`JarvisPageScaffold`). White text, no gradient text.
- **Token:** spacing 4, 8, 12, 16, 24, 32, 48px (`--space-1` to `--space-7`); a compact density multiplies by 0.8.
- **Token:** radii `--radius-control` 10px, `--radius-panel` 18px, `--radius-window` 24px, `--radius-pill` 999px (pills only
  for noninteractive status). iOS: `surfaceCornerRadius` 16, `surfaceRadius` 24.
- **Token:** control height 44px (`--control-size`), 36px inside a bar (`--control-size-inset`), pill 28px. Compact 36px
  only for fine pointers; restore 44px on touch.
- Breakpoints: phone ≤700px, tablet >700–900px, desktop >900px, wide ≥1200px.

## 5. The orb and the neural background

This is the most reusable part. Neural background source: `apps/ios/Packages/JarvisCore/Sources/JarvisCore/Neural/`
(`JarvisNeuralNetwork`, `JarvisNeuralScene`, `JarvisNeuralMotion`, `JarvisNeuralBackgroundView`).
Orb motion model: `apps/web/src/jarvis-orb-motion.ts`, ported to `Orb/JarvisOrbModel.swift`. Orb painter:
`apps/web/src/jarvis-lattice.ts` and `jarvis-lattice-painter.ts`. The scene is a pure function of (network, layout,
frame), so any 2D or WebGL painter can draw it.

### 5.1 Rendering model (background)

Two layers. A page colour sits under both.

1. **Network, drawn once** per size, theme and orb position. Never per frame.
2. **Signals, drawn every frame** on a timeline. Lit links, lit nodes, travelling pulses and flares.

Everything is real drawing, never an image. The orb's disc is cut out of both layers (even-odd clip), so nothing is
drawn over the sphere. Dark mode adds light (additive blend: `plusLighter`, canvas `lighter`); light mode draws plain,
softer strokes and multiplies line strength by 1.25.

**Network** (**Token**, `JarvisNeuralNetwork.swift`; x, y are fractions of the screen; the last column is brightness):

```text
visible   (0.81,0.055,0.95) (0.143,0.238,1.0) (0.977,0.284,0.7) (0.027,0.488,0.7)
          (0.904,0.665,0.9) (0.089,0.794,0.8) (0.911,0.859,0.85)
off-screen anchors (brightness 0, they only carry lines past the edge):
          (-0.08,0.185) (0.97,-0.05) (1.08,0.36) (-0.08,0.55) (0.32,1.05) (0.74,1.05) (1.08,0.62)
orb anchor (0.5, 0.39), replaced by the real orb centre
links     [1,4] [0,5] [0,1] [0,2] [2,4] [4,6] [3,5] [1,3]   [1,7] [0,8] [2,9] [3,10] [5,11] [6,12] [4,13]
          [2,14] [3,14] [6,14]     (14 = orb anchor; three links reach it, the rest route through the web)
```

Routes are the shortest paths (Dijkstra, x scaled by 0.46) from the orb anchor to each node. Signals follow routes.

**Painted values** (**Token**, `JarvisNeuralBackgroundView.swift`). `strength` = `intensity` (×1.25 in light mode).
Cool = `#52dcfa` dark, `rgb(20,118,141)` light. Warm = `#ffa62e` dark, `rgb(196,110,8)` light.

| Element | Core stroke / fill | Additive glow pass |
| --- | --- | --- |
| Link at rest | width 0.7, opacity 0.18 × strength | width 2.8, opacity 0.05 |
| Node at rest | dot 2.8px, opacity 0.7 × brightness | radius 7, opacity 0.17 |
| Lit link | width 0.9, opacity 0.55 × glow | width 3.2, opacity 0.16 |
| Lit node | radius 1.4 → 2.8, opacity 0.55 + 0.6 × level | radius 9 → 18, opacity 0.5 |
| Pulse trail (5 points) | width 1.8, opacity 1.2 × level × ramp² | width 6, opacity 0.3 |
| Pulse head | dot 4.8px, opacity 1.1 × level | radius 11, opacity 0.55 |
| Flare at the orb rim | none | radius 30, opacity 0.38 × strength |
| Ember (no orb on screen) | none | radius 22% of the short side, opacity 0.09 |

Link opacity follows distance *d* from the orb centre: `0.4 + 0.6 × smoothstep((d − R) / (1.6 R))`, so a line is
about 40% bright at the sphere's edge. With no orb, lines dissolve into the ember instead
(`smoothstep((d − 0.2E) / (1.4E))`, *E* = 22% of the short side). Pulse colour runs from cool to warm by `warmth` 0–1.

### 5.2 Signals: fire out from the orb and return

A **volley** is one signal on one route. It leaves the orb, runs to a node, lights it, dwells, and comes back faster.

- Out speed `0.62 × speedScale × (0.85 + 0.35 × random)` route-lengths per second of network time.
- Dwell 0.28 s at the node. Return speed is 1.25 × out. Afterglow 2.4 s. Trail length 0.28 route units.
- Glow envelope: `(1 − e^(−24t)) × e^(−t/τ)`; τ is 0.9 s at a target node, 0.5 s on the way, 0.45 s on return.
- Visible nodes are picked twice as often as anchors; the last 4 routes are skipped. Seed 1892 (deterministic).
- **Listening** reverses it: signals run only *into* the orb (85% inbound), and their rate follows the microphone level.
- Busy work **branches**: when thinking or tool use is above 0.5, 40% of volleys get a second signal on another route
  0.12–0.30 s later, at 1.1× speed and 0.85× strength.
- Nodes also **breathe**: `breathing × (0.5 + 0.5 sin(time × (0.5 + 0.13 × (i mod 5)) + i × 2.399))`.
- Network time (`flow`) is integrated, so speeding up never makes a signal jump. Frame step is clamped to 0.12 s.

### 5.3 States and effects levels

Spawn rate per second: `0.08 + 0.2 × awake + 1.5 × think + 2.4 × tool + speak × (0.5 + 1.6 × speech) + listen × (0.25 + 1.6 × input)`,
each state weight eased by smoothstep. Next signal in `(0.5 + random) / rate`, capped at `1.6 / rate`.

| Orb state | Background behaviour | Orb behaviour (web painter) |
| --- | --- | --- |
| idle | slow trickle, cyan, `awake` 0 (dormant) or 0.35 (calm) | still glass, heart pulses every 1.6 s (`pulsePeriod`) |
| listening | signals run inward, rate follows input level | lattice opens, cyan shell lifts with the mic, rim ripples |
| thinking | rate +1.5, network time ×(1 + 1.1), warmth +0.15, pairs | lattice draws in, heart brightens, slow inward tides |
| tool | quickest: rate +2.4, time ×(1 + 1.7), warmth +0.7, pairs | as thinking, warmest |
| speaking | rate follows playback level, time +0.55 × speech | lattice stretches sideways, rim rings follow playback |
| muted / reconnecting / offline | quieter; saturation 0.35 / 0.6 / 0 (colour drains) | same colour loss |

State weights follow with attack 7 and release 4.5 (per second), so a change eases and a signal in flight is never dropped.
Waking takes 1.05 s, sleeping 0.7 s (`jarvis-orb-motion.ts`).

| Effects | Where | Max signals | Rate × | Speed × | Brightness | Breathing | Frame rate (quality / cheap) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `full` (alive) | Voice, Chat, opening and loading | 9 | 1 | 1 | 1 | 0.16 | 60 fps / 20 fps |
| `calm` | every other page (with the orb behind it since 16 Nov, #1923); sheets draw the network without an orb | 2 | 0.6 | 0.55 | 0.55 (energy ×0.4) | 0.1 | 20 fps / 10 fps |
| `still` | sheets, drawer, privacy cover, Reduce Motion, previews | 0 | 0 | 0 | 0 | 0 | the network is drawn once; no timeline |

- **Calm vs alive (Decision):** the same network everywhere; only the amount of life changes. Calm is "not zero, but
  less". The opening drives the network with the *working* state while its orb stays calm; loading never implies listening.
- **Chat (Decision):** a live orb at about 30% of the height, diameter `min(0.54 × width, 240)`, at 42% opacity in dark and
  62% in light, with lines at `intensity` 0.7 so text stays legible. Voice and the opening use intensity 1.
- **Still pose (Token):** `stillTime = stillFlow = 2.6` (`jarvis-orb-motion.ts`). Reduce Motion and a Settings
  switch ("Background motion") both draw it. A Live Activity or widget draws the still orb for its state.
- **Suggestion (Windows widget):** an always-visible widget defaults to `calm`, goes `full` only while Jarvis works or
  speaks, and returns to `calm` afterwards.

### 5.4 The orb itself (web Canvas 2D, `jarvis-lattice-painter.ts`)

- Sphere fills 0.97 of half the canvas (`latticeRadiusFraction`). Glass body is a radial gradient:
  `rgba(3,8,19,0.92)` at 0, `rgba(4,13,31,0.92)` at 0.72, `rgba(6,26,62,0.95)` at 1.
- Network inside: 112 nodes in three layers, 262 connections, seed 1834 (`latticeSeed`), golden-tested in
  `jarvis-lattice.golden.json`. Connections blend cyan → teal → amber with distance from the heart.
- Draw order, all additive: heart haze, edges, dots with halos, signals, hot heart (tiny pale spark
  `rgb(255,237,199)` only at the centre), blue rim falloff, then the conic limb: cyan upper left, amber lower right.
- Edges are merged into a few Path2D batches by colour (6 buckets) and opacity (12 buckets of 0.07), so a frame costs
  a few dozen strokes, not hundreds.
- Detail by size: 120px and up draws everything; 56–120px keeps 103 connections and 74 nodes; below that 39 hubs and 41
  connections, drawn heavier. Small ambient orbs (composer, rail) are capped at 30 fps.
- Nothing spins, and the sphere, rim and position stay put. Motion is inside the glass.

### 5.5 Performance lessons (from the neural background work)

- **Cheap path.** Skip every additive glow pass; keep the crisp lines, nodes and pulses; drop to 20 fps (full) or
  10 fps (calm). iOS uses it in the Simulator (software rendering) and in Low Power Mode. A 60 fps canvas of blended
  glows starved software rendering and the capture tooling. **Suggestion (Windows):** use it on battery saver, a
  software renderer, or a remote session.
- **Additive glow is the cost.** Each link, node and pulse has a second, wider, blended pass. That roughly doubles the
  fill work. Keep it on the quality path only.
- **Split static and dynamic.** The network is painted once. Only signals redraw. Reuse gradients and merge strokes.
- **Pause when nobody looks.** Pause when the window is inactive, minimised, covered or off-screen (page visibility,
  IntersectionObserver on web). A hidden orb re-checks twice a second. A lesson from iOS: a separate overlay window never
  reported its scene phase, so animation stood still until the pause state was passed in explicitly.
- **Honour Reduce Motion** by drawing the still pose once, with no timeline running.
- **Never drive from the microphone** unless Jarvis is truly listening. iOS levels are synthetic; the web uses real ones.

Use the shared renderers in section 9 to see the orb and neural states. The network is drawn from fixed routes and
node positions, not a screenshot.

## 6. Motion

- **Tokens (web):** `--motion-press` 140ms, `--motion-state` 260ms, `--motion-panel` 420ms, `--motion-fade` 160ms,
  `--motion-ambient` 34s; easing `--ease-standard` `cubic-bezier(.2, .65, .3, 1)`, `--ease-enter` `cubic-bezier(.16, 1, .3, 1)`.
  `data-motion="calm"` slows these by 1.5×; `data-motion="reduced"` sets them to 0.
- **Tokens (iOS):** filter animation 0.18s, Voice panel orb retreat and return `.smooth` 0.55s (`voicePanelMotion`), sidebar spring response 0.36 and damping 0.88, opening crossfade 0.3s
  (0.15s with Reduce Motion), opening bar cycle 1.5s.
- **Decision:** motion needs a stated purpose: feedback, state change, hierarchy or continuity. Acknowledge a press
  immediately. Prefer transform and opacity. No perpetual decoration and no parallax.
- **Rules:** every transition survives interruption and repeated input without jumps or queued animation. Essential content
  works if animation never runs. Honour reduced motion. Stop nonessential motion off-screen or when hidden.
- Composer rim (**Token**, `JarvisRim`): one lap of light every 16s idle, 8s typing, 5s listening, 4s thinking; 15 fps.

## 7. Components and patterns worth copying

- **Controls:** glass icon button (44pt, stone icon), labelled button (text, optional icon, no large fill), menu button,
  sheet confirm (check) and sheet close (X). Busy buttons keep their width, show a loader and stay disabled.
- **Page scaffold:** transparent top bar, bold left-aligned title, trailing glass actions level with it, then content.
  One headline per block.
- **Opening screen:** on a cold start, keep the navy background dark in either appearance. Centre the orb and the white
  **Jarvis** wordmark, and keep the slim bar clear of the bottom safe area (40% of the width, 3pt, track `#1d3754`,
  amber `#fdcd51`, no caption or percentage). Indeterminate work is a moving segment, never a fake percent.
  Crossfade to Home over 0.3s without shrinking the orb; do not replay the opening on a warm resume.
- **Chat:** only the user bubble has a surface. While Jarvis works, show one steady line naming the step ("Searching your
  notes…"), not a canned spinner.
- **Tool activity:** a running row traces the icon outline and shimmers the action label, without pulsing the icon.
  Reduce Motion leaves the status readable without animation. Groups reflect the worst child state.
- **Notes graph:** label the folder clusters. Ring notes with open tasks and show the actual task count in the
  selected-note preview.
- **Watch Chat and Voice:** collapse Chat to Reply only when no draft, dictation or call would be interrupted. In
  focused Voice, replace the composer and start control with Mute and End for the same session.
- **Status under the orb:** unframed white text with a soft shadow. Transient feedback is a bottom-right smoked-glass toast
  with a dismiss control.
- **Status chips:** a dot plus a label, so colour never carries the meaning alone (presence, task state).
- **Empty and error states:** say what is missing or what failed, keep the draft or last good data, offer Retry.

## 8. Hard rules

1. **One headline per content block.** No eyebrow above it, no subtitle below it. Support text is plain body copy.
2. **No lone coloured border** (left, right, top or bottom) as an accent, and no meaning carried by border colour.
3. **No fake data.** No invented metrics, charts, screenshots or placeholder copy. Mark approved mock data clearly.
4. **Honest states.** Loading, empty, error with recovery, stale and offline are designed, and failures never look like success.
5. **Every control works** or is disabled with an explanation. Icon-only controls have accessible names.
6. **Accessibility.** 4.5:1 text contrast (3:1 large text and meaningful marks), visible keyboard focus, 44px touch targets,
   colour never alone, Reduce Motion and Reduce Transparency honoured.
7. **No new palette per screen,** no gradient text, no purple or neon glow, no emoji as icons, no second orb or background.
8. **Never draw your own orb or background:** reuse the shared one.

## 9. Authoritative sources

| Need | Read |
| --- | --- |
| Colour, type, spacing, radii, motion tokens | `apps/web/src/styles.css`, `apps/web/src/theme-preference.tsx` |
| iOS tokens, glass fill, neural page colour | `apps/ios/Jarvis/JarvisDesignSystem.swift` |
| Shared controls and `jarvisGlassSurface` | `apps/ios/Jarvis/JarvisControls.swift`, `JarvisPageHeader.swift` |
| Orb colours, motion model, lattice | `apps/web/src/jarvis-orb-appearance.ts`, `jarvis-orb-motion.ts`, `jarvis-lattice.ts`, `jarvis-lattice-painter.ts` |
| Neural background | `apps/ios/Packages/JarvisCore/Sources/JarvisCore/Neural/`, `DESIGN.md` |
| Opening layout | `apps/ios/Jarvis/JarvisOpeningView.swift` and `JarvisCore/Opening/JarvisOpening.swift` |
| Dated design decisions | `DESIGN.md` (newest first; if two conflict, the newer wins), `docs/decisions.md` |
| UI rules every builder follows | `.agents/skills/product-ui/SKILL.md`, `AGENTS.md` |
| Pending designs | [UI reference index](README.md) |

## 10. Platform notes

- **iOS is the source of truth for behaviour:** states, the neural background, glass buttons, opening and recovery flows.
  It was built first and is exercised on a device.
- **The web has the tokens.** `styles.css` is the one canonical value source and the web orb already paints on Canvas 2D.
  A Windows widget should reuse web tokens (CSS variables) and the web orb code rather than re-measure the iOS look.
- **The web has no neural background yet.** For the widget, port `JarvisNeuralNetwork`, `JarvisNeuralScene` and
  `JarvisNeuralMotion` (pure maths) and paint with Canvas 2D or WebGL as in section 5. Check the golden tests still pass.
- Where the web and iOS disagree, the newer decision wins. The web's `.primary-button` still uses a tonal fill (P14-07,
  18 Oct); the newer Notes direction (15 Nov) says neutral smoked glass with amber text. Follow the newer one.
- A Windows widget has no Live Activity or Dynamic Island. Map them to the still orb for each phase, as iOS does.
