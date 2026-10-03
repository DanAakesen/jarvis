---
title: Jarvis — Open-source Research
created: 2026-10-01
updated: 2026-10-01
status: research
scope: personal-project
---

# Jarvis — Open-source Research

Selective reuse for the Software Factory. **No runtime or foundation selected.**

- Product requirements: [PRODUCT.md](../PRODUCT.md); numbered decisions and the proof of concept: [decisions.md](decisions.md).
- Findings below summarize earlier documentation/source review; they are not runtime tests.
- No candidate has a verified Jarvis/Foundry end-to-end integration.
- Memory and self-learning design are **undefined and deferred**.

## Evaluation criteria

| Requirement | What reuse must support |
| --- | --- |
| Kanban UI | Task state, progress, and start/pause/resume through Jarvis contracts. |
| Agent selection | Codex or Copilot chosen independently per task. |
| Parallel tasks | One active coding agent per task; isolated workspaces across projects. |
| Project settings | Different PR/merge permissions; no implicit deployment. |
| Continuity | Background work, event reconnect, and safe recovery. |
| Subscriptions | Verify the actual hosted CLI/SDK login path. |
| Maintainability | Clear adapter/service boundaries, suitable licenses, and manageable dependencies. |

## Candidates

| Candidate | Platform / license | Useful building blocks | Main gap |
| --- | --- | --- | --- |
| **Orca** | React web, Node runtime, Electron; MIT | Codex/Copilot integration, worktrees, review, remote execution | Copilot terminal support does not prove full structured steering/recovery. |
| **Cloudroom core** | Linux/Rust API; Apache-2.0 | Native CLI sessions, command receipts, queues, SSE, recovery | No Copilot adapter in the reviewed runtime. |
| **Cloudroom GUI** | React/Vite, Node, Electron; MIT with some Apache-2.0 helpers | Task/thread model, provider contracts, environment lifecycle | Extensive internal dependencies and cloud-account coupling. |
| **Hermes / Mission Control** | Workflow and dashboard references | Kanban, dependencies, handoffs, attempts, activity feed | Inspiration only; does not establish the complete Jarvis product. |
| **Vibe Kanban** | Rust + React web; Apache-2.0 | Kanban issues, per-task workspace (branch, terminal, dev server), review comments sent to the agent, PRs; Codex and Copilot CLI | Local worktree execution; no per-task cloud sandbox. |
| **CLI Agent Orchestrator** | Python server, tmux; Apache-2.0 | Codex and Copilot CLI providers, agent status detection, HTTP API, web UI | Parses terminal output rather than structured events. |
| **OpenHands** | React web, Python agent server; MIT | Per-conversation sandboxes, multiple agent backends, scheduled/event automation | Codex and ACP agents; Copilot through its ACP mode untested. |

## Orca — reuse notes

| Strength | Constraint |
| --- | --- |
| Separate web client and Node runtime | Shared types, PTY/native dependencies, and persistence remain coupled. |
| Codex structured sessions and Copilot hooks | Reviewed structured router routes Claude/Codex; Copilot parity needs verification. |
| Worktrees, review feedback, GitHub integration | Worktrees isolate files/branches, not credentials or processes. |
| Remote server and workspace lifecycle patterns | Foundry/Azure recipe unverified; remote server needs protected access. |

- Replace or secure the reviewed Node secret-store behavior before cloud use.
- Prefer selected adapters/contracts over a complete desktop fork.
- Key source paths: `vite.web.config.ts`, `src/main/orcad/orcad-entry.ts`, Copilot hook definitions, and the structured session router.

## Cloudroom — reuse notes

| Building block | Value for Jarvis |
| --- | --- |
| Durable command receipts | Distinguish accepted work from started/completed work. |
| Native Codex app-server sessions | Preserve the existing coding loop and native session identities. |
| Sequence-numbered SSE events | Rebuild status after reconnect. |
| Explicit uncertain state after restart | Reconcile dispatched work before resending. |
| Task status separate from session status | An idle agent does not imply a completed task. |
| Environment ownership/attempt tracking | Prevent old attempts from overwriting newer state or cleaning up unrelated resources. |

- Copilot requires an adapter or a different runner.
- Compute sleep does not prove Azure scale-to-zero.
- Database history alone does not restore workspace files or native sessions.
- Container compatibility, isolation, authentication, and Foundry hosting remain unverified.
- A full GUI fork would add substantial dependency and account-integration work.
- Key source paths: `src/runtime/codex.rs`, `src/session/outbox.rs`, session/storage docs, and GUI task/environment contracts.

## Workflow inspiration

- Dependencies between tasks and parallel execution of independent work.
- Compact handoffs: objective, changes, validation, open questions, and PR link.
- Execution history, visible blockers, activity feed, and usage.
- Review comments sent back to the running agent (Vibe Kanban).
- Proof of work before a PR lands: CI status, review feedback, walkthrough (Symphony).
- Any future role/review model must respect one active coding agent per task.

## Recommended research order

1. The [proof of concept](reference/coding-sandbox-prototype/REPORT.md) passed: Foundry Hosted Agents with one ACP adapter for Codex and Copilot.
2. Use Orca, Vibe Kanban, or CLI Agent Orchestrator adapters where they reduce a demonstrated integration gap.
3. Use Cloudroom command/event/recovery patterns as references.
4. Adopt a complete runtime only when its benefit exceeds the integration burden.

## Sources — earlier review, 1 October 2026

| Topic | Primary references |
| --- | --- |
| Orca architecture | [Run modes](https://www.onorca.dev/docs/ways-to-run), [remote servers](https://www.onorca.dev/docs/remote-servers), [web build](https://github.com/stablyai/orca/blob/main/vite.web.config.ts), [Node runtime](https://github.com/stablyai/orca/blob/main/src/main/orcad/orcad-entry.ts) |
| Orca agent support | [Copilot hooks](https://github.com/stablyai/orca/blob/main/src/main/copilot/copilot-managed-hook-definitions.ts), [structured router](https://github.com/stablyai/orca/blob/main/src/main/native-chat/agent-session-wire/structured-agent-session-adapter-router.ts), [license](https://github.com/stablyai/orca/blob/main/LICENSE) |
| Cloudroom core | [API](https://github.com/davidondrej/cloudroom-core/blob/main/docs/api.md), [harnesses](https://github.com/davidondrej/cloudroom-core/blob/main/docs/harnesses.md), [sessions](https://github.com/davidondrej/cloudroom-core/blob/main/docs/session-lifecycle.md), [storage](https://github.com/davidondrej/cloudroom-core/blob/main/docs/storage.md), [license](https://github.com/davidondrej/cloudroom-core/blob/main/LICENSE) |
| Cloudroom GUI | [README](https://github.com/davidondrej/cloudroom-gui/blob/main/README.md), [tasks](https://github.com/davidondrej/cloudroom-gui/blob/main/plugins/tasks/shared/contract.ts), [environments](https://github.com/davidondrej/cloudroom-gui/blob/main/docs/environment-provisioning.md), [license](https://github.com/davidondrej/cloudroom-gui/blob/main/LICENSE) |
| Vibe Kanban | [README](https://github.com/BloopAI/vibe-kanban/blob/main/README.md), [supported agents](https://vibekanban.com/docs/supported-coding-agents), [license](https://github.com/BloopAI/vibe-kanban/blob/main/LICENSE) |
| CLI Agent Orchestrator | [README](https://github.com/awslabs/cli-agent-orchestrator), [Copilot provider](https://github.com/awslabs/cli-agent-orchestrator/blob/main/docs/copilot-cli.md), [license](https://github.com/awslabs/cli-agent-orchestrator/blob/main/LICENSE) |
| OpenHands | [README](https://github.com/OpenHands/OpenHands), [license](https://github.com/OpenHands/OpenHands/blob/main/LICENSE) |
| Workflow inspiration | [Hermes Kanban](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban-tutorial), [Mission Control](https://github.com/builderz-labs/mission-control), [Hermes Control Center](https://hermes-cc.toloui.de/), [Symphony](https://github.com/openai/symphony) |
