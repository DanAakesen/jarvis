# Reference

Prototype code and evidence from 1–3 October 2026. Read-only: P2 ports the coding-sandbox runner and P4 ports the voice agent (see [Reuse from the prototypes](../../PLAN.md#reuse-from-the-prototypes)). Delete this folder once both are ported.

| Folder | Contents |
| --- | --- |
| [coding-sandbox-prototype](coding-sandbox-prototype/) | Foundry hosted-agent runner, driver, infrastructure scripts. Reports: [proof of concept](coding-sandbox-prototype/REPORT.md), [restart](coding-sandbox-prototype/RESTART-REPORT.md), [build](coding-sandbox-prototype/BUILD-REPORT.md). |
| [voice-prototype](voice-prototype/) | Hosted Jarvis voice agent, voice-agent provisioning, terminal voice client. Report: [voice](voice-prototype/REPORT.md). |

- The Azure environments (`rg-jarvis-poc`, `rg-jarvis-voice-poc`) were deleted on 3 October 2026; the scripts here would create new ones with new names.
- These files mention `jarvis.md` and `jarvis-flows.html`, the earlier design documents. Their content now lives in [PRODUCT.md](../../PRODUCT.md), [architecture.md](../architecture.md), [decisions.md](../decisions.md), and [architecture-flows.html](../architecture-flows.html).
- Decisions and learnings from these reports are in [decisions.md](../decisions.md); the reports keep only run instructions and raw evidence.
