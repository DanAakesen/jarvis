# Web UI style audit (P14-01)

This audit records the recurring UI forms across the web app and the canonical
treatments selected from the existing Jarvis design system. The shared source
of truth is `apps/web/src/styles.css`; route stylesheets own workflow layout,
not parallel palettes or control systems.

## Surface coverage

The audit covered the shared shell, desktop rail and mobile navigation, header
controls and popovers, workspace/chat composer and voice controls, Settings,
Factory project and task pages, Daily overview and records, Proactive list,
item and settings, shared dialogs, and the loading, empty and error patterns
used by those routes. Style families in the remaining CSS modules were
inventoried to identify route-specific exceptions.

## Canonical forms

| Recurring element | Variants found (source and selector/component) | Canonical form and reason |
| --- | --- | --- |
| Button | `styles.css`: `.primary-button`, `.secondary-button`, `.ghost-button`, `.danger-button`, `.danger-button--filled`, `.button-group`, `.settings-back`, `.jobs-action`, `.workspace-control`; `proactive.css`: `.proactive-text-toggle`, `.proactive-snooze > summary`; Factory task/release action overrides; Daily keeps `.daily-page button` | Use the filled primary, surfaced secondary, quiet ghost, low-emphasis danger and filled-confirmation danger levels. Shared states, radius, type, icon alignment and busy width live in `styles.css`; specialized controls keep their workflow role. Action rows own spacing and wrap/stack at phone widths. Compact actions are 36px on fine pointers and at least 44px on coarse pointers. |
| Icon button | `styles.css`: `.rail-button`, `.topbar-icon-button`, `.workspace-icon-control`, `.workspace-tab-close`, `.modal-close`, `.folio-action`, `.release-trail-button`; `ConversationToast.css`: toast dismiss; `CameraPreview.css`: camera controls | Use the shared quiet surface treatment, `--radius-control` and visible focus. Icon-only actions remain at least 44px on touch layouts and keep an accessible name. Drag handles and media controls remain semantic exceptions. |
| Text input | `styles.css`: `.settings-field input`, `.project-form`, `.task-form-field`, `.kanban-search input`, `.usage-field`; `daily/daily.css`: `.daily-page input`; `proactive.css`: `.proactive-feed-input input`; `notes/NotesArea.css` and `styles.css`: integrated note, Folio and knowledge searches | Standard fields use `--surface`, neutral `--control-rule`, `--radius-control`, inherited text and the shared focus outline. Integrated searches keep their transparent inner field when the surrounding search surface provides the boundary and focus treatment. |
| Select | `styles.css`: `.settings-field select`, `.timeline-toolbar select`, `.usage-field select`, `.role-controls select`, `.kanban-select select`; `daily/daily.css`: `.daily-page select`; `proactive.css`: source controls | Use the same field surface, neutral boundary, control radius and visible focus as text inputs. Native option semantics and route-specific widths remain. |
| Toggle and segmented choice | `styles.css`: `.advanced-toggle input[role="switch"]`, `.advanced-segmented`; `Presence.tsx` mode choices; `daily/daily.css`: `.daily-view-switch`; `styles.css`: `.usage-segmented`; `ProjectsPage.tsx`: `.project-policy-choice` native radios | Preserve native radio/switch semantics. Selected choices use the existing selected surface and text roles; selection is not communicated by border colour alone. The project policy keeps its labelled, explained two-choice radio group. |
| Surface or card | `styles.css`: `.panel`, `.workspace`, `.settings-section`, `.project-item`, `.kanban-column`, `.kanban-card`, `.jobs-popover`, `.modal`; `daily/daily.css`: `.daily-page`, `.daily-records`; `proactive.css` and `styles.css`: `.proactive-item`, `.proactive-block` | Content panels use existing surface roles, `--rule`, panel geometry and `--panel-shadow`. Settings sections now use the same shared panel treatment as project cards; the sticky save bar uses a panel shape instead of a capsule. Stage-backed conversation glass remains distinct because it is part of the accepted workspace composition. |
| List row | `styles.css`: `.activity-list`, `.jobs-list`, `.jobs-item`, `.kanban-card`; `daily/daily-overview.css`: `.daily-overview-row`; `daily/daily.css`: `.daily-table`; `proactive.css`: `.proactive-item-row`, `.proactive-source-row`, `.proactive-runs-list` | Scannable collections use neutral `--rule` separators and consistent spacing. Keep cards only for distinct units of work or context; tables retain their real tabular structure. |
| Chip or badge | `styles.css`: `.task-chip`, `.task-state-chip`, `.jobs-outcome`; `daily/daily-overview.css`: `.daily-status`; `proactive.css`: `.proactive-new`, `.proactive-urgency` | Reserve `--radius-pill` for compact status and category marks. Keep a readable label, icon or other non-colour signal with status colour. Interactive tabs, filters and actions use `--radius-control`. |
| Popover or sheet | `styles.css`: `.jobs-popover`, `.more-menu-list`, `.more-menu-flyout`, `.modal`; `MobileShell.tsx` / `styles.css`: `.mobile-menu-sheet`; mobile `.context-panel` detail sheet | Use a neutral `--rule` boundary, shared surface and panel radius. Background work and attention now share the opaque `--surface` popover treatment. Preserve the established fixed positioning, safe-area geometry, focus handling and dismissal behavior. |
| Section heading | `styles.css`: `h1`, `h2`, `h3`; `SettingsPage.tsx` sections; `daily/daily.css` record heading; `proactive.css` block heading | Follow the existing heading scale and one-headline hierarchy. Route-specific heading size remains where it expresses a real level in the content structure; no eyebrow or subtitle is added. |
| Body and caption text | `styles.css`: `--type-body`, `--type-small`, `--type-caption`; `daily/daily.css`: `.daily-meta`, `.daily-evidence`; `proactive.css`: `.proactive-item-meta`; `styles.css`: `.jobs-item-meta`, `.activity-meta` | Use the existing type roles and `--text` / `--text-muted`. Metadata may be smaller, but long or actionable text remains readable and wraps rather than clipping. |
| Empty state | `styles.css`: `.project-empty`, `.workspace-empty`, `.task-column-empty`, `.usage-empty`; `daily/daily.css`: `.daily-empty`; `daily/DailyOverview.tsx`; Proactive page lists | Explain the actual empty condition in nearby body text, use the existing surface and typography roles, and show only a relevant working action. Keep `status` announcements where already present; do not invent counts or sample content. |
| Error banner and inline error | `styles.css`: `.settings-feedback`, `.projects-feedback`, `.project-policy-feedback`, `.task-control-error`, `.release-feedback`, `.usage-feedback`; `ConversationHistory.css`: `.conversation-history-error`, `.chat-error`; `daily/daily.css`: `.daily-notice[role="alert"]`; `proactive.css`: `[role="alert"]`; `JobsChip.tsx`: `.jobs-item-error` | Keep field/action-local failures inline in the error text role. Block-level Daily and Proactive alerts use `--error-surface`, `--error` and neutral structure; retain their `role="alert"` and retry action. Do not encode error meaning in border colour alone. |
| Loading state | `Loader.tsx` variants `dots`, `rows`, and `orb`; `ConversationHistory.css`: `.conversation-loading`; `styles.css`: `.task-window-loading`; Daily and Proactive pending states | Reuse `Loader` for page/collection loading and concise status text for background refreshes. Preserve the existing content while refreshing where the workflow already supports it; reduced motion never hides essential state. |

## Rendered checks

Compared the pre-change and current app in headless Chromium at 390×844 with
touch emulation and 1440×900, in light and dark. The isolated Vite/auth harness
used synthetic settings and project data. Inspected Settings, the empty Factory
board, the project completion-policy control, Daily and Proactive page/item error states,
the Background work popover, and the chat composer. Exercised policy save,
Daily and Proactive retry, popover open, and composer focus. Neither version
emitted browser console errors. Reduced-motion emulation was also checked: the
Background work popover animation resolves to `none` and Settings content
remains available.

The Daily and Proactive APIs intentionally returned synthetic 503 responses,
so only their error and retry states were verified, not healthy-data states.
The attention popover could not be opened because the harness had no synthetic
attention event; its shared popover surface is used by the inspected Background
work popover. Screenshots were captured locally but could not be attached to the
PR with the available tools. No live backend or real sign-in was used.

## Bounded follow-up

The app has more than 40 independently styled route and component surfaces, so
this pass prioritized the shell/header popovers, shared chat controls, Settings,
Factory project policy, Daily, and Proactive as requested. The global shared
button and shell tokens continue to style existing consumers, but this pass did
not recast the distinct layouts and component-specific states for Knowledge and
Folio, Notes editing, Usage and Status, camera/voice panels, Factory release and
task-detail histories, or embedded generated views. Their workflow-specific
geometry and behavior were not changed; they remain candidates for a separate
visual review rather than being folded into this bounded patch.

This is local rendered evidence, not live or human acceptance. Before/after
screenshots remain unattached; the uninspected attention popover and healthy
Daily/Proactive data states are also open visual follow-up.

## Pass 2

This pass follows the canonical forms above and the bounded follow-up from
P14-01. The shared source remains `apps/web/src/styles.css`; component styles
keep their workflow layout and consume its existing tokens.

| Recurring element | Variants found (source and selector/component) | Pass 1 match? | Pass 2 change |
| --- | --- | --- | --- |
| Panels and cards | `styles.css`: `.usage-hero`, `.usage-card`, `.usage-details`, `.usage-empty`, `.system-status-panel`, `.release-section`, `.task-meta`, `.task-detail-section`; `notes/NotesArea.css`: `.notes-conflict`, `.notes-comparison pre` | Partial. Usage and Status used stage slabs with oversized radii; Factory history used 8px panels; Notes comparison used unstructured one-off surfaces. | Moved Usage, Status, release and task panels to the shared translucent surface, neutral `--rule`, `--radius-panel`, `--panel-shadow`, and spacing tokens. Notes conflict/comparison now use structural rules and panel/control radii. |
| Search, fields, and actions | `styles.css`: `.folio-search`, `.folio-rename input`, `.folio-action`, `.folio-kind`, `.knowledge-results`; `CameraPreview.tsx`: preview/camera retry buttons; `CameraPreview.css`: `.camera-status-control`; Usage segmented buttons | Partial. Shared button treatment was already present in most controls, but Folio search/rename were below 44px, Folio actions lacked a focus rule, and camera retries had a parallel style. | Raised Folio search/rename controls to 44px, added explicit Folio action focus, and reused `.secondary-button` for both camera retries. The Knowledge results surface now uses `--radius-panel`. Existing Usage selected, hover, pressed, and focus states remain. |
| Graph and timeline surfaces | `styles.css`: `.release-graph-scroll`, `.timeline-payload pre`, `.knowledge-results` | Partial. Graph scrolling had a hard-coded light background and 6px radius; timeline payloads used a second 6px radius. | The graph scroll surface now uses `--surface` and `--radius-control`; timeline payloads use the same control radius. Existing contained horizontal scrolling and focus indication remain. |
| Typography and spacing | `styles.css`: Usage/Status headings, `.usage-page`, `.usage-results`, `.usage-grid`, `.usage-tiles li`; `CameraPreview.css`: `.camera-preview-live`; `VoiceControls.css`: `.voice-status-label` | Partial. Several Usage/Status sizes and gaps were raw values; camera status text used a one-off size; voice arrival used a fixed duration. | Reused the existing `--type-lead`, `--type-caption`, `--space-*`, and `--motion-state` tokens. Other text and spacing already use the canonical type roles and were left unchanged. |
| Status, rows, and recovery | `daily/DailyOverview.tsx` / `daily-overview.css`: `.daily-overview-row`, `.daily-status`; `ProactiveArea.tsx` / `proactive.css`: `.proactive-item`, `.proactive-block`; `status/StatusPage.tsx`: `.system-status-row`, `.system-status-feedback`; `usage/UsagePage.tsx`: `.usage-empty` | Mostly. Daily and Proactive already use the shared status, row, empty/error, and tokenized control forms; Status feedback and Usage surfaces were the exception. | Status feedback now uses a neutral structural rule and `--error-surface` with an explicit error-text role. Usage empty/loading treatment is unchanged apart from its shared panel surface. Healthy Daily and Proactive states required no CSS changes. |
| Camera and voice states | `CameraPreview.tsx` / `CameraPreview.css`: `.camera-preview-picture`, `.camera-preview-live`, `.camera-status-control`, retry actions; `VoiceControls.css`: `.voice-status-label` | Partial. Preview/status geometry and retry actions diverged; voice typography and motion were raw values. | Reused panel/pill radii and caption typography, shared retry buttons, visible control focus, and tokenized voice type/motion. Camera status controls retain their explicit hover, pressed, disabled, and focus treatments. |
| Release and task history | `factory/ReleasePage.tsx`: `.release-section`, `.release-graph-scroll`; `factory/TaskDetailPage.tsx`: `.task-meta`, `.task-detail-section`, `.timeline-payload pre` | Partial. Release/task action controls already matched; panel, graph, and payload geometry did not. | Updated only the mismatched panel, graph, and payload surfaces as described above; retained release/task interactions and scroll behavior. |
| Attention popover | `AttentionPopover.tsx`: `.attention-popover`; `JobsChip.tsx`: `.jobs-popover` | Yes. The attention popover already shares the canonical opaque `--surface`, neutral boundary, and panel radius used by Background work. | No CSS change. Opened it with a synthetic attention event and verified the activity item and close behavior. |
| Generated views | `GeneratedViewRenderer.tsx`: table, detail, timeline, chart and source-note renderers; `styles.css`: `.generated-view-table`, `.generated-view-details`, `.generated-view-timeline`, `.generated-chart`, `.chart-legend`, `.generated-view-source-note` | Partial. PR #953's source note, contained table scrolling and whole-cell values already use shared text, spacing and neutral rule tokens; timeline/chart spacing and axis text were still raw, and table headers lacked a muted surface. | Added the shared muted surface and weight to table headers; moved chart/timeline spacing and chart axis text to existing tokens. Preserved #953's source note and inner table scroll behavior. |

The patch changes seven web files and this audit plus one plan row, staying below
the 40-file bound. `DESIGN.md` and `docs/decisions.md` remain unchanged because
the work reuses visual choices already recorded by Pass 1.

## Pass 2 rendered checks

Compared the pre-change and current app in headless Chromium using scratch-only
auth and API fixtures at 390×844 with touch emulation and 1440×900, in light and
dark. Inspected Knowledge/Folio, Notes, Usage, Status, healthy Daily and
Proactive data, Factory release, and the attention popover at both sizes and
themes. The fixtures used only synthetic notes, events, usage entries, status
checks, Daily rows, Proactive findings, release records, and task history.

Opened the Notes conflict/comparison and task-history workspace with synthetic
responses in the same viewport/theme matrix. Exercised Folio open, Usage
grouping, Status refresh, opening a Daily record, expanding a Proactive finding,
release details, and the attention popover. The expected synthetic Notes 409
response produced the conflict state; no other page or browser-console errors
were observed, and document width stayed within each viewport.

For generated views, compared the merged #953 baseline with the current build
using a scratch component harness containing the real `Workspace` and
`GeneratedViewRenderer`. A synthetic table and source note were checked at both
sizes and themes; the table remains contained and scrollable within its window
on the phone, with no document-width overflow. A synthetic chart was also
checked in both themes at phone width. The shared muted table header is
theme-aware, and chart labels resolve to the shared caption size.

The real `CameraPreview` and `VoiceControls` components were also rendered in a
scratch workspace harness at both sizes and themes. The synthetic camera error
and retry action remained visible; keyboard activation of Start voice reached
the browser's microphone-unavailable recovery state. No camera, microphone
stream, or connected voice session was used. Reduced-motion emulation was
checked on Daily and Proactive, where essential content remained available.
Screenshots were captured locally under `/tmp/jarvis-p14-browser/`; the
available tools could not attach them to the PR. These are local rendered
checks, not live-backend or human acceptance.

## Pass 2 not done

- Physical camera output, microphone input, and a connected voice session were
  not verified; no real media device was used.
- Keyboard scrolling of a wide generated table and reduced-motion behavior for
  an active voice status were not verified.

## Pass 3: button system (18 October 2026; P14-03)

Removed the shared primary button's 32px layout margin. Existing row and form
spacing stays on its action container; the deployment form uses a 42px grid
row-gap (the former 10px gap plus the removed 32px button margin). Secondary
recovery actions that had their own top margin now use spaced `.button-group`
wrappers. No button behavior, route or accessible name was intentionally
changed.

The unclassed Knowledge, SettingsAdvanced, Usage and Notes buttons now use the
ghost level. `styles.test.tsx` guards the shared variants' margin, radius,
focus, coarse-pointer target and no-decorative-rim contracts, and checks that
production TSX buttons have a class. The Daily CSS tree remains untouched.

## Pass 3 rendered checks

The scratch Vite harness stubbed auth only in `/tmp`, used synthetic API
responses, and ran the actual app in Chromium. Before/after contact sheets show
the same nine workflows—Settings, destructive confirmation, Factory board,
task window, Proactive, Notes/Knowledge toolbar, chat, empty state, and busy/
disabled—at 390×844 and 1440×900 in both themes:

| Viewport | Light before | Light after | Dark before | Dark after |
| --- | --- | --- | --- | --- |
| 390×844 | [WebP](ui/p14-03/before-light-390x844-workflows.webp) | [WebP](ui/p14-03/after-light-390x844-workflows.webp) | [WebP](ui/p14-03/before-dark-390x844-workflows.webp) | [WebP](ui/p14-03/after-dark-390x844-workflows.webp) |
| 1440×900 | [WebP](ui/p14-03/before-light-1440x900-workflows.webp) | [WebP](ui/p14-03/after-light-1440x900-workflows.webp) | [WebP](ui/p14-03/before-dark-1440x900-workflows.webp) | [WebP](ui/p14-03/after-dark-1440x900-workflows.webp) |

Standalone Settings captures are included in the same folder. The rendered
checks reported no browser console errors. Keyboard traversal showed a visible
3px focus outline on all 12 shared/specialized button probes; touch emulation
reported coarse pointers and 44px-or-larger targets. The Check now busy state
kept its width unchanged at both viewport sizes. Reduced-motion emulation was
active during the checks and retained the existing motion-token behavior.

The 320px board check found the same pre-existing 384px document width before
and after; overflow comes from the Kanban board's issue-list item, not from a
button. The parallel P14-05 overflow sweep owns that non-button layout, so this
button pass leaves it unchanged. Other checked pages had no new document-width
increase.

## Pass 3 (borders, radii, surfaces)

Counts below compare the web stylesheet state at the start of this pass with the
final state. PostCSS counted literal-radius declarations (excluding tokens,
keywords, `0` and `50%`), `999px` declarations, visible side borders, inset
`box-shadow` declarations, and each raw hex/RGB/HSL color occurrence outside a
custom property. The issue's filing inventory predates this branch baseline;
these measurements use the same parser and scope before and after.

| Stylesheet | Literal radii | `999px` | Visible side borders | Inset shadows | Raw color literals |
| --- | ---: | ---: | ---: | ---: | ---: |
| `styles.css` | 51 → 1 | 11 → 0 | 23 → 24 | 29 → 0 | 36 → 0 |
| `ConversationHistory.css` | 6 → 0 | 0 → 0 | 0 → 0 | 14 → 7 | 13 → 3 |
| `ChatAttachments.css` | 3 → 0 | 0 → 0 | 0 → 0 | 1 → 0 | 0 → 0 |
| `JarvisStage.css` | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 4 → 0 |
| `VoiceControls.css` | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 4 → 0 |
| `CameraPreview.css` | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| `ConversationToast.css` | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| `PushNotifications.css` | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| `daily/daily-overview.css` | 0 → 0 | 0 → 0 | 1 → 1 | 0 → 0 | 0 → 0 |
| `daily/daily.css` | 0 → 0 | 0 → 0 | 1 → 1 | 0 → 0 | 0 → 0 |
| `daily/nutrition-targets.css` | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| `notes/NotesArea.css` | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| `proactive.css` | 0 → 0 | 0 → 0 | 2 → 2 | 0 → 0 | 0 → 0 |
| **Total** | **60 → 1** | **11 → 0** | **27 → 28** | **44 → 7** | **57 → 3** |

The lone remaining radius is `.deployment-add` (`14px`), a P14-03-owned button
exception. Seven inset-shadow declarations and three color literals remain only
in the reasoned P14-03 button/voice-control exceptions listed below. The four
Daily border declarations already used `--rule`; `apps/web/src/daily/**` was not
changed. One existing `.app-topbar` reset became a 1px `--rule` separator; the
total side-border declaration count remains 31 (27 visible plus four resets
before, 28 visible plus three resets after).

### Side-border classification

Every visible side border is structural, a row separator, or the resize-grip
glyph; all use a single 1px `--rule` line. The `.app-topbar` entry occurs in two
rules and is counted twice. Zero/reset declarations are listed separately.

| File | Selector | Property | Decision |
| --- | --- | --- | --- |
| `styles.css` | `.area-rail` | `border-right` | Navigation/page structural separator; neutral `--rule`. |
| `styles.css` | `.area-sidebar` | `border-right` | Desktop sidebar/page structural separator; neutral `--rule`. |
| `styles.css` | `.app-topbar` (two declarations) | `border-bottom` | Shared header separator; replaced the second rule's inset imitation with neutral `--rule`. |
| `styles.css` | `.context-panel` | `border-left` | Desktop context-panel boundary; neutral `--rule`. |
| `styles.css` | `.setup-status > div + div` | `border-top` | Separates status rows; neutral `--rule`. |
| `styles.css` | `.workspace-resize-edge-corner::after` | `border-right`, `border-bottom` | Functional resize-grip glyph; retained at 1px in neutral `--rule`. |
| `styles.css` | `.generated-view-table th, .generated-view-table td` | `border-bottom` | Structural table-row separator; neutral `--rule`. |
| `styles.css` | `.activity-list > li + li` | `border-top` | Separates activity rows; neutral `--rule`. |
| `styles.css` | `.repository-list` | `border-top` | Separates the list from its preceding section; neutral `--rule`. |
| `styles.css` | `.repository-list > li + li` | `border-top` | Separates repository rows; neutral `--rule`. |
| `styles.css` | `.project-archive` | `border-top` | Separates the archive action from the project list; neutral `--rule`. |
| `styles.css` | `.release-record-list, .release-run-list, .release-deployment-list` | `border-top` | Separates release lists from their headings; neutral `--rule`. |
| `styles.css` | `.release-record, .release-run-list > li, .release-deployment-list > li` | `border-bottom` | Separates release-history rows; neutral `--rule`. |
| `styles.css` | `.task-usage-table th, .task-usage-table td` | `border-top` | Separates task-usage rows; neutral `--rule`. |
| `styles.css` | `.usage-group` | `border-top` | Separates usage groups; neutral `--rule`. |
| `styles.css` | `.usage-tool-counts` | `border-top` | Separates tool counts; neutral `--rule`. |
| `styles.css` | `.usage-tool-counts dl > div` | `border-top` | Separates tool-count rows; neutral `--rule`. |
| `styles.css` | `.usage-table th, .usage-table td` | `border-top` | Structural usage-table separator; neutral `--rule`. |
| `styles.css` | `.area-sidebar` | `border-bottom` | Mobile sidebar/page structural separator; neutral `--rule`. |
| `styles.css` | `.context-panel` | `border-bottom` | Mobile context-panel boundary; neutral `--rule`. |
| `styles.css` | `.mobile-menu-actions` | `border-top` | Separates navigation from menu actions; neutral `--rule`. |
| `styles.css` | `.system-status-row + .system-status-row` | `border-top` | Separates status rows; neutral `--rule`. |
| `daily/daily-overview.css` | `.daily-overview-row` | `border-top` | Daily row separator; existing neutral `--rule`, unchanged. |
| `daily/daily.css` | `.daily-table th, .daily-table td` | `border-bottom` | Daily table separator; existing neutral `--rule`, unchanged. |
| `proactive.css` | `.proactive-block` | `border-bottom` | Separates Proactive sections; neutral `--rule`. |
| `proactive.css` | `.proactive-item-row, .proactive-source-row, .proactive-runs-list > li` | `border-bottom` | Separates Proactive rows; neutral `--rule`. |
| `styles.css` | `.area-sidebar` | `border-right: 0` | Mobile reset prevents a duplicate desktop-side separator. |
| `daily/daily.css` | `.daily-table tr:last-child td` | `border-bottom: 0` | Suppresses a trailing rule after the final table row; unchanged. |
| `proactive.css` | `.proactive-item-row:last-child, .proactive-source-row:last-child, .proactive-runs-list > li:last-child` | `border-bottom: 0` | Suppresses a trailing rule after each final row. |

### Ratchet exceptions and shared surfaces

`apps/web/src/stylesheets.test.tsx` parses every CSS file recursively. Its
reasoned exceptions are value-pinned so a changed border or shadow cannot inherit
an unrelated selector's exemption.

| Measure | Allow-listed form | Reason |
| --- | --- | --- |
| Radius | `0`; `50%`; `.deployment-add` at `14px` | Square edges and true circles are intentional; the deployment button is owned by P14-03. |
| Side borders | Entries in the classification table above | Structural separators and functional grip glyph only; 1px neutral `--rule`. |
| Inset shadows | Three `.conversation-history .composer-send` rules; two `.input-orb span` states; `.conversation-latest` and its hover state | Button rules are P14-03-owned; the orb's actual interior shading is not a pseudo-border. |
| Raw colors | `.composer-send:not(:disabled)` background; `.input-orb span` background; `.conversation-latest` shadow | Existing button/voice-control highlights are P14-03-owned; exact values are pinned. |

Shared panels, dialogs, popovers, cards, selected rows and hover states now use
the established surface roles, neutral `--rule`, and `--panel-shadow`. Selected
items use a complete selected surface rather than a colored edge. Chat bubbles
and stage glass retain their existing role-specific surfaces. Light and dark
themes use the same semantic tokens.

### Pass 3 rendered checks

Captured 24 synthetic before/after WebP images (1.1 MB total) for Settings with
the Presence popover open, the Factory task window, and conversation history
with an attachment. Each view was rendered at 390×844 with touch emulation and
1440×900 in light and dark. Chromium reported no console errors or horizontal
overflow; the task, attachment, settings and popover content rendered from
synthetic fixtures. Files are in [`docs/ui/p14-04/`](ui/p14-04/).

The keyboard focus check at 390×844 showed a visible 3px focus outline on the
skip link. Reduced-motion emulation kept the page content available. These are
local synthetic Chromium checks, not live-service or human acceptance. Usage,
Status, Knowledge, Notes, and a separate healthy Factory board view were not
captured in this bounded screenshot set.
