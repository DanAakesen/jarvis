# Jarvis docs

Index of the documentation folders. The source of truth for which files matter and what each owns is [.github/copilot-instructions.md](../.github/copilot-instructions.md); `AGENTS.md` only points to it. Rules for this folder: one doc per topic, updated in place; new docs go in the right folder and are added to that map; evidence, screenshots, per-build notes, design handoffs and prototype snapshots are not committed (they live in pull request bodies and CI artifacts); anything obsolete is deleted, because Git history keeps it.

## Read first

| Doc | What it tells you |
| --- | --- |
| [../p0.md](../p0.md) | Dan's current priorities, short. He edits it freely and Jarvis reads it. |
| [../PRODUCT.md](../PRODUCT.md) | What Jarvis is for, the daily core, priorities P0/P1/P2, Dan's standing rules. |
| [../PLAN.md](../PLAN.md) | Current state, what is in flight, next steps, open decisions. Its task tables are read by the plan-status bot. |
| [architecture.md](architecture.md) | Components, data flows, deployment, invariants and known limits. |
| [agent-context.md](agent-context.md) | How to work here: agent context and log sources, setup, workflow, merge and TestFlight. |
| [decisions.md](decisions.md) | Confirmed decisions and learnings, newest first. Older ones are indexed in [archive/](archive/). |

## Operations and catalogues

| Doc | What it tells you |
| --- | --- |
| [runbook.md](runbook.md) | Production operations: deploy, rollback, incident steps. |
| [features.md](features.md) | Feature catalogue built into the backend image. Editing it, even in a docs-only change, triggers backend CI and Deploy. |
| [tool-conformance.md](tool-conformance.md) | Generated catalogue of every Jarvis tool and its first-search result. Regenerate it, never hand-edit. |
| [github-app-manifest.json](github-app-manifest.json) | The GitHub App manifest read by the webhook code and tests. |

## Folders

| Folder | Contents |
| --- | --- |
| [reference/](reference/README.md) | Data model, log access, the Daily health contract and the pinned Daily v182 source snapshot. |
| [ios/](ios/) | `integration-contract.md` (backend endpoints the iPhone app uses) and `apple-capabilities.md` (entitlements and capabilities). |
| [pi/](pi/cutover.md) | The PI switch-on checklist and the pending decisions. |
| [inbox-loop/](inbox-loop/acceptance.md) | Inbox loop activation, acceptance, MCP and Shortcut: built, off by default. |
| [ui/](ui/style-guide.md) | The UI style guide and the design references still waiting to be implemented. |
| [archive/](archive/) | Monthly decision indexes. Full historical text stays in Git. |

Design direction lives in [../DESIGN.md](../DESIGN.md) and the screen map in [../ui.md](../ui.md). Module READMEs sit next to their code: `db/`, `infra/`, `runner/`, `apps/vault-mirror/`, `agents/jarvis/` and `apps/backend/src/*`; `apps/backend/src/modules.README.md` indexes the backend ones.

## Where does new content go?

- A confirmed decision or learning: the top of [decisions.md](decisions.md), newest first.
- Progress, next steps, blockers: [../PLAN.md](../PLAN.md).
- A change to how the system works: [architecture.md](architecture.md).
- A new command, rule or procedure: [agent-context.md](agent-context.md).
- Evidence of a check or a design capture: the pull request body.
