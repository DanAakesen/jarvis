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
