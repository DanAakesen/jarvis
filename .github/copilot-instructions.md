<!-- Source of truth for working in this repository. Started from shared-project-templates 2.2.3 and now maintained by hand; AGENTS.md only points here. The hashes in .template-state.json are intentionally stale so a template sync treats this file as customised. -->

# Project working agreement

This file is the source of truth for how to work in this repository. `AGENTS.md` only points here. Change a rule in this file, never in a second copy.

## Key files

These files describe the project **as it is now**, not its history (Git and `docs/decisions.md` keep that). Read the ones your task touches, searching large files by heading, and refresh any that changed or that you lost after compaction. Update the ones your change affects in the same change, using actual outcomes, and separate proposals from verified behaviour. If a file is missing, inspect the repository and continue with the evidence you have. Do not ask Dan to locate context that this map names.

| File | What it owns |
| --- | --- |
| `.github/copilot-instructions.md` | This file: the working rules and the map of every important document. |
| `AGENTS.md` | Pointer to this working agreement for tools that start at the root. |
| `p0.md` | Dan's current priorities. Read it first when working on Jarvis; it is not a plan or a history. |
| `PRODUCT.md` | What Jarvis is for, who uses it, the daily core, requirements per area, success criteria, what is out of scope and Dan's standing rules. |
| `PLAN.md` | Current state and what is in flight, next steps, blockers, open decisions A to F, the active issue backlog and the task tables the plan-status bot reads. Ideas are proposals, not authorization. |
| `DESIGN.md` | How each surface should compose and behave: Chat, Voice, Notes, Watch, Home and the rest. |
| `ui.md` | The screen map: every destination on iPhone, Watch, widgets and web, what it shows today and what is still open. |
| `docs/ui/style-guide.md` | The look: colour, glass, type, the orb and neural background, motion and hard rules. Read it first for any new or visible UI, then `DESIGN.md`. |
| `docs/architecture.md` | Stack and versions, components, data flows, deployment, invariants and known limits. |
| `docs/agent-context.md` | Agent context and log entry points, setup, commands, development workflow, merge, TestFlight and repository hygiene. |
| `docs/decisions.md` | Dated decisions and learnings with rationale and evidence, newest first; older ones are indexed in `docs/archive/`. Check it before a change that may conflict with an earlier choice. |
| `docs/runbook.md` | Production operations: deploy, rollback, key rotation and incident steps. |
| `docs/reference/logs.md` | Diagnostic sources, safe fields, access and coverage limits. |
| `docs/features.md` | The feature catalogue built into the backend image. Editing it, even in a docs-only change, triggers backend CI and Deploy. |
| `docs/tool-conformance.md` | Generated catalogue of every Jarvis tool and its first-search result. Regenerate it, never hand-edit. |

## Other documents

Start with `README.md` (what the repo is and how to run it) and `docs/README.md` (index of the `docs/` folders).

- **Contracts and reference:** `docs/ios/integration-contract.md` (native backend endpoints), `docs/ios/apple-capabilities.md` (entitlements), `docs/reference/README.md` (reference index), `docs/reference/data-model.md` (SQL ownership), `docs/reference/daily/*.md` (Health upload, scope and SQL mapping).
- **Acceptance and parked work:** `docs/pi/cutover.md` (PI acceptance and retirement gates), `docs/inbox-loop/*.md` (inbox activation and acceptance, MCP and Shortcut).
- **Decision history:** `docs/archive/decisions-index-*.md` points to dated decisions in Git history. Do not copy the full text into the archive.
- **Component READMEs:** `db/README.md` and `db/migrations/README.md` (SQL), `infra/README.md` (Bicep), `runner/README.md` (coding runner), `apps/vault-mirror/README.md` (mirror), `agents/jarvis/README.md` (legacy hosted Python agent), `apps/backend/src/modules.README.md` (module index) and `apps/backend/src/**/README.md` (module contracts).
- **Skills:** `.agents/skills/engineering/SKILL.md` and `.agents/skills/product-ui/SKILL.md`.
- **PI agent definition inputs (deployed, Foundry-owned text):** `agents/pi/instructions.md`, `agents/pi/voice-instructions.md` and `agents/pi/skills/*/SKILL.md`. Never edit the KEEP THIS BLOCK text.
- **Not documents:** `CopilotAndCodex.md` (Astra's advice file) exists only on Dan's machine and is never committed.

## Documentation rules

- **Only current information.** A key file that is wrong is a bug. Fix it in the change that made it wrong, or delete the sentence. Do not leave "was", "will be" or "pending" text that no longer matches reality.
- **One doc per topic, updated in place.** Decisions go to `docs/decisions.md`, progress to `PLAN.md`, requirements to `PRODUCT.md`, UI behaviour to `DESIGN.md`, screens to `ui.md`, runtime changes to `docs/architecture.md`, procedures to `docs/agent-context.md`.
- **A new markdown file** is added to this map and to `docs/README.md` in the same change. Otherwise its content goes into an existing doc or the pull request body.
- **Do not commit working material.** Evidence, screenshots, captures, per-build notes, design handoffs, review write-ups and prototype snapshots belong in the pull request body or CI artifacts. A design reference stays in `docs/ui/` only until it is built; then its lasting rules move to the style guide or `DESIGN.md` and the files are deleted. Git history keeps what was removed.
- **Never commit** secrets, real personal data, live logs or large binaries (over 1 MB needs a reason in the PR).

## Work and communication

- Reply in the user's language. Lead with the outcome and keep responses concise. Use bullets, numbered steps, or tables for scanning and comparison; use a diagram, chart, or screenshot when it makes the subject clearer. Use an available visualization skill when a visual will materially clarify a workflow, comparison, or dataset.
- Write new project documentation and UI copy in English by default unless the user or audience requires another language. Preserve meaning, voice, source data, quotations, domain terms, names, and identifiers. Use concrete words and active sentences; remove filler, repeated summaries, and unsupported claims. Review UI labels and recovery copy in their actual context.
- Distinguish confirmed facts, assumptions, estimates, and open questions when they affect the answer. Verify time-sensitive external claims.
- Continue authorized work through appropriate validation. Ask only when missing information materially changes the result or an action needs approval.
- Use available tools and the current environment. Follow the project's stack and conventions; add dependencies or abstractions only for demonstrated needs.
- Preserve existing work and keep unrelated edits separate. A skill or template does not expand the user's authorization.
- Search OIL or another authorized knowledge store only when the task needs prior personal, work, or project context absent from the current conversation or repository. Skip routine vault lookups for self-contained requests. Keep project facts and decisions in this repository.

## Quality and delivery

- Validate input, permissions, and secrets at the relevant boundaries. Make failures and data freshness visible; never invent missing real data.
- Use existing checks appropriate to the change and risk. For meaningful UI work, inspect the actual interface and relevant mobile or interaction states when available.
- Report what changed, what was verified, and material limitations. Distinguish a local check from live or human verification.
- Do not publish, deploy, send external messages, spend money, expose secrets, or destroy data without the required authorization. Prepare a reviewable result before requesting any missing approval.
- Before finishing development work, update all project documents affected by the change in the same change: `PRODUCT.md` (requirements/scope), `DESIGN.md` (UI choices), `docs/architecture.md` (stack/data flows), `docs/agent-context.md` (setup/commands/constraints), `docs/decisions.md` (confirmed choices), `PLAN.md` (implementation progress), and relevant diagrams or references. Keep documentation consistent with the actual implementation. Read and update only relevant sections; distinguish proposals and unverified behavior.
- Record confirmed project decisions in `docs/decisions.md`; keep proposals and unresolved questions separate.
- Keep `PLAN.md` current as planned work progresses: update the active phase, next step, blockers, and completed steps using actual outcomes. Mark a phase complete only when its completion criteria are met. Isolated corrections do not require a new phase.

## Frontend requirements

These requirements apply to user-facing UI changes, even when a skill is not selected.

1. Before creating, reviewing, or changing UI layout, styling, animation, charts, assets, or interaction behavior, read `.agents/skills/product-ui/SKILL.md`, `docs/ui/style-guide.md`, `ui.md` and the relevant parts of `PRODUCT.md` and `DESIGN.md`. Backend-only edits and nonvisual corrections do not require this skill; the requirements here still apply to any affected UI.
2. Use one headline per content block. No eyebrow/kicker above a main heading, no subtitle/secondary heading below it, and no combination of these. Supporting explanation belongs in ordinary body text.
3. Never use a lone colored left, right, top, or bottom border as an accent, or border color alone to convey meaning. Use layout, spacing, surface, typography, icons, and text; reserve borders for structure.
4. Build the real user workflow. Every control must work or be clearly disabled with an explanation. No decorative filler, fabricated evidence or metrics, fake product screenshots, or generic repeated card layouts without a product reason.
5. Follow the agreed visual direction and references with coherent hierarchy, typography, spacing, colors, and components. Finish alignment and hover/focus/pressed states; do not substitute untouched component-library defaults for product-specific design.
6. Use purposeful, responsive animation for feedback, state changes, hierarchy, or continuity. Transitions must tolerate interruption and repeated input. Honor reduced motion; essential content must remain usable if animation never runs.
7. Provide intentional responsive layouts, accessible labels and keyboard/focus behavior, and the loading, empty, error/recovery, selected, disabled, and success states the workflow needs. Color alone must not convey meaning.
8. Before handoff, inspect visible changes in a real browser at relevant desktop and mobile widths when available. Compare against the agreed direction, exercise changed controls and states, and observe animation in motion; explicitly check rules 2–7 and fix violations. Report what was inspected and any remaining limitation; never claim browser verification without doing it.

## Engineering requirements

Apply these requirements to software changes, including small corrections, even when a skill is not selected.

1. Before changing business logic, APIs, persistence/migrations, authentication/permissions, jobs, integrations, runtime/build configuration, or system structure, read `.agents/skills/engineering/SKILL.md` and the affected project context. Read only the relevant sections. UI composition and interaction work uses `product-ui`; a change spanning both domains uses both workflows.
2. Follow the selected stack and nearby conventions. Make the smallest coherent change; add layers, packages, services, or automation only for a demonstrated need. Solo work requires no PR, agent team, or fixed ceremony.
3. Validate untrusted input and authorize the specific operation/resource at the server boundary. Hidden or disabled UI controls are not permission checks; deny access when permission cannot be verified.
4. Keep secrets server-side in protected configuration. Never commit or expose credentials or unnecessary sensitive data in client bundles, fixtures, prompts, exports, errors, or logs. Use maintained security libraries and parameterized database operations.
5. Preserve existing work, public contracts, access controls, and persisted data. Changes to them need explicit migration/compatibility and recovery handling; follow the user's authorization for destructive or external actions.
6. Make failures and partial completion visible. Bound external work, handle cancellation and resource lifetimes, and retry only transient failures with idempotency protection for side effects. Never replace a failure with false success.
7. Use requested validation and existing project tools appropriate to the change. Do not weaken failing checks or claim unexecuted checks passed. Separate observed results, baseline failures, and unverified behavior.
8. Review the final diff for unrelated edits, exposed secrets, incomplete behavior, and stale context. Update the architecture map for changed boundaries and the decision log for confirmed choices; report behavior changed, actual checks, and material limitations.

## UI components

All buttons, menus, sheet actions, orbs and page headers must use the shared components in `apps/ios/Jarvis`: `JarvisIconButton`, `JarvisLabelledButton`, `JarvisMenuButton`, `JarvisSheetConfirmButton`, `JarvisSheetCloseButton` and `JarvisComposerIconButton` (`JarvisControls.swift`), `JarvisOrb`, and `JarvisPageScaffold` with `JarvisPageHeader` (`JarvisPageHeader.swift`). Never call `glassEffect`, define a `ButtonStyle`, or draw an orb in a screen file; use `jarvisGlassSurface` for glass. For iPhone and Watch surfaces, inherit the [shared material settings](../docs/ui/style-guide.md#3-glass-and-surfaces). Keep gradient, frost and glass strengths in the shared renderer. Screens select a surface role. All dashboard cards inherit Card glow from Appearance. To change the look, change the shared component. `JarvisDesignSystemGuardTests` fails the build when a screen breaks this.

## Installed skills (paths relative to the repository root)

- .agents/skills/engineering/SKILL.md (load only when its workflow fits the task)
- .agents/skills/product-ui/SKILL.md (load only when its workflow fits the task)
