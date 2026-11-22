# Jarvis docs

One map of the documentation. The most important files are also listed in [.github/copilot-instructions.md](../.github/copilot-instructions.md) and [AGENTS.md](../AGENTS.md). Rules for this folder: one doc per topic, updated in place; new docs go in the right folder and are added to that map; evidence, screenshots, per-build notes, design handoffs and prototype snapshots are not committed (they live in pull request bodies and CI artifacts); anything obsolete is deleted, because Git history keeps it.

## Read first

| Doc | What it tells you |
| --- | --- |
| [../PRODUCT.md](../PRODUCT.md) | What Jarvis is for, the daily core, priorities P0/P1/P2, Dan's standing rules. |
| [../PLAN.md](../PLAN.md) | Current state, what is in flight, next steps, open decisions. Its task tables are read by the plan-status bot. |
| [architecture.md](architecture.md) | Components, data flows, deployment, invariants and known limits. |
| [agent-context.md](agent-context.md) | How to work here: setup, verified commands, workflow, merge and release, TestFlight, cost and safety rules. |
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
| [inbox-loop/](inbox-loop/design.md) | Inbox loop design, acceptance, MCP and Shortcut notes: built, switched off, waiting for Dan's decision. |
| [ui/](ui/README.md) | The UI style guide and the few design references still waiting to be implemented. |
| [archive/](archive/) | Decision history only (`decisions-YYYY-MM.md` and their indexes), cited by code comments such as L63. |

Design direction lives in [../DESIGN.md](../DESIGN.md). Module READMEs sit next to their code: `db/`, `infra/`, `runner/`, `apps/vault-mirror/`, `agents/jarvis/` and `apps/backend/src/*`; `apps/backend/src/modules.README.md` indexes the backend ones.

## Where does new content go?

- A confirmed decision or learning: the top of [decisions.md](decisions.md), newest first.
- Progress, next steps, blockers: [../PLAN.md](../PLAN.md).
- A change to how the system works: [architecture.md](architecture.md).
- A new command, rule or procedure: [agent-context.md](agent-context.md).
- Evidence of a check or a design capture: the pull request body.
