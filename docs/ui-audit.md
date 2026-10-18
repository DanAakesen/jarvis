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
| Button | `styles.css`: `.primary-button`, `.secondary-button`, `.settings-back`, `.jobs-action`, `.workspace-control`; `daily/daily.css`: `.daily-page button`; `proactive.css`: `.proactive-text-toggle`, `.proactive-snooze > summary`; Factory task/release action overrides | Use `.primary-button` for the primary action and `.secondary-button` for quiet actions. Specialized action buttons retain their workflow role but use `--radius-control`, shared hover/pressed feedback and visible focus. Preserve compact desktop exceptions only where the shared 44px touch target is restored for coarse pointers. |
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

The code audit is not rendered-browser acceptance. Before/after screenshots
and the 390×844 / 1440×900 light/dark interaction matrix remain separate
acceptance evidence.
