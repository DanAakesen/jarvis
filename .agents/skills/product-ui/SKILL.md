---
name: product-ui
description: Create, change, or review product UI layout, styling, animation, charts, assets, and interaction behavior. Also use for visual asset or motion graphic deliverables. Skip backend-only edits and nonvisual corrections.
---

# Product UI

Use this as the single frontend workflow. The project entrypoint contains the mandatory baseline; this skill explains how to meet it. Read the sections relevant to the change, without loading additional frontend instruction files. For an asset or motion graphic request, use the assets and tool-selection sections and inspect the requested deliverable.

## Understand the affected workflow

- Follow the `AGENTS.md` context map to the relevant sections of `PRODUCT.md`, `DESIGN.md`, and feature documentation. Search large documents by heading or topic. Read architecture context only when the change affects data flow, state ownership, or integration boundaries.
- Inspect existing routes, components, styles, dependencies, and assets before replacing them. Follow the selected stack and conventions; add packages only for a concrete need.
- Identify the user, their main task, and the successful outcome. Clarify only unresolved choices that materially change the design; make routine, reversible choices and continue.
- Choose hierarchy, page shape, navigation, density, primary action, supporting information, and applicable states from that task. A monitor, queue, editor, comparison, review, or settings screen should reflect how it is used.
- Make the primary action and the information needed to complete it obvious. Persistent side navigation must serve the information architecture. A sidebar, top bar, and card grid is not a design concept by itself.

## Create a specific, polished visual direction

- For a new visual identity or substantial redesign, use relevant visual references and show three distinct concepts before implementation. Explain how each supports the product's audience and task; agree the direction with the user. Changes within an agreed direction reuse it.
- Record the selected references, their useful qualities, typography roles, palette intent, density, and defining visual element in `DESIGN.md`. Keep references as guidance; preserve the project's own content and composition rules.
- Choose a deliberate typography hierarchy, spacing rhythm, content width, alignment, density, and palette for the product's audience and content. Carry those choices through every affected screen and state.
- Give a prominent graphic or expressive treatment a specific job, such as explaining the product, showing a relationship, or emphasizing the primary interaction. Keep surrounding composition disciplined and readable.
- Use rows or tables for scanning and comparison; use cards for distinct units of action or context. Repeat layouts only for genuinely equivalent items. Avoid decorative metric tiles, excessive pills/badges, stock feature grids, and empty panels used to fill space.
- Do not add hero statistics, charts, section numbers, testimonials, invented customer logos, placeholder copy, or fake-precise values merely to make a screen look complete. Mark approved mock data clearly.
- Do not default to purple/violet, gradient text, neon glow, or glass effects. Use them only when the brief or established brand supports them.
- Also question automatic cream/serif/clay palettes, a single highlighted word in headings, decorative numbering, tracked uppercase labels, and arrows appended to every action. These require a product or brand reason; established brand choices remain valid. The headline and border bans below are absolute.
- Do not ship dead controls, fake affordances, or a static dashboard poster in place of the requested workflow. Do not build product screenshots from styled `div`s. Use real imagery or a clearly identified generated concept when a visual is useful.
- Use the project's icon components or text labels. Do not use emoji as interface icons.
- **One headline per content block:** no eyebrow/kicker above the main heading and no subtitle/secondary heading below it. Supporting explanation is ordinary body text.
- **No lone colored border:** no single colored left, right, top, or bottom edge as an accent, and no meaning carried by border color alone. Use layout, spacing, surface, typography, icons, and text; borders may provide real structure.
- Apply these hard composition rules even when a reference or component library uses the banned pattern.
- Before handoff, check whether changing the labels would make the screen fit any generic app unchanged. Revise the generic hierarchy, structure, or interaction that causes it.

## Keep one coherent design system

- Extend the existing CSS variables, theme, and shared components. Keep shared color, typography, spacing, radius, state, and motion values in one canonical code source.
- Use existing semantic roles. Add tokens only for real reusable decisions; avoid duplicate aliases or a second token inventory in `DESIGN.md`. Name tokens by role, such as `--surface-default`, `--text-muted`, and `--focus-ring`. Local exceptions may use raw values.
- Equivalent headings, buttons, navigation items, panels, rows, forms, and status messages should share anatomy and behavior across routes. Change them only for a workflow reason.
- Use color for brand, hierarchy, and state, paired with labels, icons, shapes, or position when meaning matters. Respect the established brand; do not add a new palette or component library for one screen.
- Add chart or asset tokens only when those elements exist. Keep `DESIGN.md` aligned with implementation: stable intent, important conventions, and the location of canonical values.
- Polish component geometry: optically align icons and labels, balance padding, and relate corner treatment to size and nesting. Use consistent icon size and stroke within a family; inspect alignment at the actual rendered size.

## Implement complete interactions

- Every visible control must perform its labelled action or be clearly disabled with an explanation. Put feedback near the action, prevent duplicate submissions while pending, explain failures, and provide recovery.
- Implement applicable loading, empty, error, selected, disabled, and success states. Preserve enough context for users to understand partial completion or stale data.
- Finish hover, focus, and pressed states as deliberately as the resting state. Touch interaction must work without hover; pending feedback must keep the control's identity and avoid accidental layout shifts.
- Use semantic HTML, visible form labels, accessible names for icon-only controls, keyboard operation, visible focus, sufficient contrast, and suitable touch targets. Keep icon behavior consistent within an action family.
- For sorting, grouping, staging, prioritizing, or moving board items, consider drag-and-drop. Provide keyboard alternatives and visible pickup/drop states when used.
- Define responsive rearrangement for the actual content. Check zoom, long values, long headings and labels, narrow widths, scrolling, and overflow. Avoid clipping, overlap, and accidental horizontal scrolling.

## Use animation deliberately

- Add motion when it clarifies feedback, a state change, hierarchy, or continuity. Name that purpose before choosing the effect. Remove motion that only decorates or delays the user's task.
- Keep essential content visible and usable if an entrance animation is skipped or never runs. Do not make information depend on an animation callback.
- Honor `prefers-reduced-motion`; reduce or remove movement while preserving information, feedback, and usable states.
- Reuse the project's duration, easing, and motion conventions. Avoid one-off timing, perpetual loops, or parallax added solely to make the page feel active.
- Match motion to purpose and frequency: acknowledge presses immediately; keep frequent actions brief. Avoid repeating the same fade-and-slide entrance on every section or animating every card on hover.
- Use these recipes when relevant: menus/popovers originate from their trigger; expanding panels preserve spatial context; reordered items retain identity and move to their new positions; confirmation feedback stays near the completed action. Match easing to movement, and use springs when gesture continuity benefits.
- Allow reversal and interruption without jumps, stuck states, or queued animations after rapid input. Animation must not delay action handling. Preserve keyboard focus through transitions.
- Prefer transform/opacity for movement and fades where they fit. Animate only needed properties; avoid `transition: all`. Stop nonessential animation offscreen or while inactive, and inspect expensive blur, shadows, and large animated surfaces for jank.

## Charts and data inside the product

- Identify the user's question, source, grain, filters, measures, units, signs, time period, and aggregation. Reconcile totals before plotting. Distinguish missing, stale, estimated, and partial values from complete observations.
- Choose the simplest chart, table, or text summary that answers the question. Add filtering, inspection, or linked selection when it improves comparison or action; do not add decorative charts or novel chart types without a reason.
- Label axes, series, units, dates, and definitions. Choose scales and ordering that preserve the conclusion; do not use misleading truncation or imply causation from timing alone.
- Provide color-independent series/state meaning and a text summary or table alternative where useful. Show source and freshness when they affect interpretation. Use the same visual tokens and interaction standards as the surrounding product.
- Verify plotted values against the source and inspect labels, layout, and interactions. Standalone analytical or publication figures use the separate `data-visualization` skill when installed; app chart UI belongs here.

## Source and place visual assets

- Start with the asset's purpose and the user's existing material. Use real screenshots when factual UI state matters. Use available image generation for illustrations, concepts, or visual exploration when it helps the brief.
- Choose SVG for diagrams, scalable shapes, and illustrations needing editable geometry; use suitable raster assets for imagery and texture. Base graphics on actual product content and relationships rather than unrelated decorative effects.
- For motion graphics or video, define the message, destination, aspect ratio, duration, and necessary sound/captions from the brief. Build a coherent sequence, preview representative frames and the full playback, and inspect the rendered export. Keep factual UI demonstrations source-faithful.
- Verify external image URLs and relevant usage terms. Record source/license information when applicable. Do not imply generated customer imagery is evidence or that a mockup is a running product.
- Keep functional UI text and controls in the interface rather than rasterizing them. Use accessible icon components for ordinary UI icons.
- If an asset or tool is unavailable, reuse suitable material or choose a design that works without it. Use an explicit placement only for a requested unfinished concept and explain the limitation; do not ship broken images or unlabeled placeholders.
- Use meaningful filenames, suitable dimensions/compression, responsive crops, and alt text when needed. Inspect rendered placement, contrast, and loading behavior. Retain only assets the deliverable uses.
- Follow the user's brief and authorization. Do not require a specific provider, production agent, or extra approval sequence.

## Select specialist tools only for the task

Reuse the project's stack and available tools. Consult the relevant official documentation when using a tool; do not load this entire list's documentation. Scaffold initialization installs no packages, MCP servers, hooks, or global configuration. Add a dependency or integration only when the deliverable needs it and authorization covers the change.

| Need | Option and selection rule |
|---|---|
| Simple visual state transition | Existing CSS; use for self-contained hover, color, or opacity changes. |
| Rich React interaction | [Motion](https://motion.dev/docs/react) for gestures, shared layout, enter/exit, or SVG animation. Its optional [AI Kit](https://motion.dev/docs/ai-kit-install) provides current documentation search; premium tools require Motion+. |
| Established component behavior/source | [shadcn MCP](https://ui.shadcn.com/docs/mcp) when compatible with the chosen stack/registry. Adapt retrieved components to the agreed design and hard bans. |
| A specific animated graphic or effect | Selected [React Bits](https://github.com/DavidHDev/react-bits) source when it fits the brief. Review the component's dependencies, usage terms, accessibility, and performance. |
| Motion graphic/video export | Choose [Hyperframes](https://github.com/heygen-com/hyperframes) for HTML compositions or [Remotion](https://www.remotion.dev/docs/ai/skills) for React compositions according to the project and deliverable. These serve video production. |
| Optional objective design scan | [Impeccable detector](https://impeccable.style/docs/detector/) for a focused source or rendered-page check, for example `npx impeccable detect src/` or a running local URL. Use the standalone scan; retain this project's guidance and document ownership. Review findings against deliberate brand choices. |

## React implementation, when applicable

- Follow the repository's React version, router, TypeScript settings, styling, naming, and test tools. Add state, form, routing, or component packages only for a demonstrated need.
- Keep state with its narrowest owner; share it only when the workflow needs one source of truth. Derive values during render. Use effects for external synchronization, not copying props or deriving values.
- Give components coherent responsibilities. Split for comprehension, reuse, or testability; avoid pass-through wrappers and arbitrary one-component-per-file rules.
- Use stable keys based on item identity, especially for insertion, removal, reordering, or refresh.
- Handle pending, success, empty, and failure states; cancel overlapping work or guard against stale responses. Handle promise rejections. Hydration or storage failure must settle into usable content or a visible error, never a permanent skeleton.
- Use server/client boundaries and suspense only when supported by the framework and useful for the actual flow. Keep secrets and server-only modules out of client bundles.
- When tests are requested, cover user-visible behavior with existing tools, controlled time, and deterministic async fixtures; avoid coupling tests to component internals.

## Inspect and finish

- For visible changes, run the app and inspect the actual UI at relevant desktop/mobile widths when browser access is available. Exercise changed controls and applicable states; inspect navigation, focus, long content, overflow, and console errors.
- Compare rendered composition with the agreed direction and references. Check typography, alignment, spacing, and component states with actual content. Observe transitions in motion, including rapid repeated input and reduced motion; screenshots alone cannot verify animation.
- Check the headline and border bans, product-specific hierarchy, shared styling, meaningful motion/reduced motion, accessibility, responsive behavior, and working controls before handoff. Fix concrete findings; subjective scores do not replace inspection.
- An optional detector can identify concrete problems; a clean scan does not prove visual or accessibility quality. Keep intentional brand choices, resolve real findings, and inspect the finished interface.
- If a browser is unavailable, perform useful code and responsive review and state that limitation. Never claim rendered verification without doing it.
- Report the implemented behavior, actual checks, and material unverified states. Update `DESIGN.md` only for confirmed design decisions changed by the work.
