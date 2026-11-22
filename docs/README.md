# Jarvis documentation

New machine? Start with the [operator manual](agent-context.md). For what to do next, use [PLAN.md](../PLAN.md); for what Jarvis should do, use [PRODUCT.md](../PRODUCT.md). **Live** means maintained as part of the current workflow. **Reference** means a contract, research, design handoff or fixture to consult for that area. **Historical** means evidence of an older state, not instructions to run today.

## Start here

| Document | Status | Use it for |
| --- | --- | --- |
| [Operator manual](agent-context.md) | Live | Local setup, offline checks, task ownership, merge and release. |
| [Architecture](architecture.md) | Live | Runtime ownership, data flows, invariants and deployment. |
| [Design direction](../DESIGN.md) | Live | Current composition and interaction choices. |
| [UI style guide](ui/style-guide.md) | Live | Shared tokens, components, state and motion rules. |
| [Decisions](decisions.md) | Live | Accepted choices, why they were made and what is still open. |
| [Features](features.md) | Live | Feature inventory and status by surface; current priorities live in the plan. |
| [Data model](data-model.md) | Reference | SQL domains and tables; migrations are authoritative. |
| [Runbook](runbook.md) | Live | Operations and recovery; check the operator manual before running any production command. |
| [Backend logs](backend-logs.md) | Live | Allowlisted log fields, evidence and safe diagnostics. |
| [Jarvis logs](jarvis-logs.md) | Reference | Log tool contracts and safe output. |
| [Tool conformance](tool-conformance.md) | Live | Generated PI discovery and call coverage; a test reads this exact path. |
| [Architecture flows](architecture-flows.html) | Historical | Earlier interactive flow and evidence map; use the current architecture for PI. |
| [Open source](open-source.md) | Reference | Evaluated libraries and upstream references. |
| [GitHub Actions templates](github-actions-templates.md) | Reference | CI and workflow patterns for managed projects. |

## What changed on main, 15–22 November 2026

This is a map of merged work, not a device acceptance report. Priorities and the next build are in [PLAN.md](../PLAN.md); trade-offs and open decisions are in [decisions](decisions.md).

| Area | Merged change |
| --- | --- |
| PI runtime | The managed harness became the default for Chat and Voice ([#1910](https://github.com/DanAakesen/jarvis/pull/1910)). GPT-Live replaced the old spoken provider path ([#1984](https://github.com/DanAakesen/jarvis/pull/1984)); both live instruction texts moved under Foundry ownership ([#1992](https://github.com/DanAakesen/jarvis/pull/1992), [#1994](https://github.com/DanAakesen/jarvis/pull/1994)). |
| Tool reliability | Added replay evidence, Chat/Voice parity, the generated conformance suite, plain failures, write receipts and ordering ([#2016](https://github.com/DanAakesen/jarvis/pull/2016), [#2021](https://github.com/DanAakesen/jarvis/pull/2021), [#2022](https://github.com/DanAakesen/jarvis/pull/2022), [#2017](https://github.com/DanAakesen/jarvis/pull/2017), [#2023](https://github.com/DanAakesen/jarvis/pull/2023), [#2024](https://github.com/DanAakesen/jarvis/pull/2024)). Bounded reads and safer rate-limit handling followed ([#2030](https://github.com/DanAakesen/jarvis/pull/2030), [#2032](https://github.com/DanAakesen/jarvis/pull/2032), [#2033](https://github.com/DanAakesen/jarvis/pull/2033)). |
| Proactive and delivery | Situational state and follow-ups, tracked GitHub/calendar/reminder signals, better wake diagnostics, and durable exact reply pushes ([#1964](https://github.com/DanAakesen/jarvis/pull/1964), [#1985](https://github.com/DanAakesen/jarvis/pull/1985), [#1986](https://github.com/DanAakesen/jarvis/pull/1986), [#2018](https://github.com/DanAakesen/jarvis/pull/2018), [#2019](https://github.com/DanAakesen/jarvis/pull/2019), [#2025](https://github.com/DanAakesen/jarvis/pull/2025)). |
| Knowledge | Added the Vault-backed inbox loop ([#1860](https://github.com/DanAakesen/jarvis/pull/1860), [#1868](https://github.com/DanAakesen/jarvis/pull/1868)), improved mirror evidence ([#1963](https://github.com/DanAakesen/jarvis/pull/1963)), and separated Personal Memory from Vault knowledge again ([#1983](https://github.com/DanAakesen/jarvis/pull/1983)). |
| iPhone and Watch | Added the lattice opening, Notes/Tasks redesign, in-reply content, Voice panel, Watch composer and Voice improvements; tightened drafts, Notes titles, Watch capture recovery and live Voice following ([#1853](https://github.com/DanAakesen/jarvis/pull/1853), [#1899](https://github.com/DanAakesen/jarvis/pull/1899), [#1933](https://github.com/DanAakesen/jarvis/pull/1933), [#1934](https://github.com/DanAakesen/jarvis/pull/1934), [#2027](https://github.com/DanAakesen/jarvis/pull/2027), [#2028](https://github.com/DanAakesen/jarvis/pull/2028), [#2029](https://github.com/DanAakesen/jarvis/pull/2029), [#2034](https://github.com/DanAakesen/jarvis/pull/2034)). |

## Areas and contracts

The PI architecture and cutover checklist supersede the November harness trial. The [trial analysis](https://github.com/DanAakesen/jarvis/pull/1852) and [revised proposal](https://github.com/DanAakesen/jarvis/pull/1854) remain in Git history. The withdrawn dedicated Health host is not part of the SQL upload contract.

| Document | Status | Use it for |
| --- | --- | --- |
| [PI cutover](pi/cutover.md) | Reference | Cutover inventory and the remaining old-engine decision; not an executable deletion plan. |
| [PI implementation plan](pi/plan.md) | Historical | Original managed-harness plan; superseded for ongoing work by the architecture and cutover checklist. |
| [Proactive assistance](proactive-assistance.md) | Reference | Proactive concepts, sources and feedback; the current PI path is in architecture. |
| [Proactive diagrams](proactive-diagrams.md) | Reference | Earlier scheduling and delivery diagrams. |
| [Event pipeline design](proactive-events/design.md) | Reference | Queue, source policy, interrupt tiers and acceptance boundaries. |
| [Notification research](research/intelligent-proactive-notifications.md) | Reference | Research behind useful, non-repetitive reach-outs. |
| [Inbox loop design](inbox-loop/design.md) | Reference | Built, switched off by default; needs Dan's decision to switch on. Defines Vault capture, triage and follow-up. |
| [Inbox acceptance](inbox-loop/acceptance.md) | Reference | Switch-on checklist and pending production and device acceptance. |
| [Inbox MCP](inbox-loop/mcp.md) | Reference | Dedicated inbox MCP contract. |
| [Inbox Shortcut](inbox-loop/shortcut.md) | Reference | Capture setup and the write-only route. |
| [Health ingestion](daily-health-ingestion/README.md) | Reference | Current SQL upload and processing contract. Production uploads and phone acceptance remain unverified. |
| [Daily migration](daily-migration.md) | Historical | Old-to-current Health migration decisions; linked by the interactive map. |
| [Daily schema mapping](daily-schema-mapping.md) | Reference | Retained source-to-target field mapping, not a migration to run. |
| [Nutrition export Shortcut](nutrition-export-shortcut.md) | Reference | Export setup and its ingestion contract. |
| [iOS build plan](ios/build-plan.md) | Reference | Native target milestones and implementation map. |
| [Apple capabilities](ios/apple-capabilities.md) | Reference | Apple sign-in, push and capability boundaries. |
| [iOS integration contract](ios/integration-contract.md) | Live | Native sign-in, backend contracts and evidence requirements. |
| [Watch design](ios/design/watch/README.md) | Reference | Native Watch references and handoff map. |
| [Watch implementation](ios/design/watch/implementation.md) | Reference | Watch app, complications and native integration detail. |
| [Watch native evidence](ios/design/watch/native/README.md) | Reference | Native captures and their verification scope. |
| [Watch input fixtures](ios/design/watch/inputs-2026-11-10/README.md) | Historical | Dated Watch form design inputs and screenshots. |
| [Watch Factory/lift inputs](ios/design/watch/factory-lift-inputs-handoff-2026-11-10.md) | Reference | Native form handoff for task and lift capture. |
| [Watch Home and complications](ios/design/watch/next-complications-and-home-2026-11-10.md) | Historical | Explored navigation and complication alternatives. |
| [Watch steps and reconnect](ios/design/watch/steps-reconnect-handoff-2026-11-10.md) | Reference | Steps presentation and reconnect handoff. |

## UI handoffs and evidence

| Document | Status | Use it for |
| --- | --- | --- |
| [Approved 16 November handoff](ui/approved-handover-2026-11-16.md) | Reference | Agreed Graph, Voice panel and conversational blocks. |
| [3D graph](ui/graph-3d/brief.md) | Reference | Folder cluster composition and selection behaviour. |
| [Jarvis window sheet](ui/jarvis-window-sheet/brief.md) | Reference | iPhone panel concepts and the chosen Voice direction. |
| [Map and route card](ui/map-route-card/brief.md) | Reference | Route visual design brief, not an implementation claim. |
| [Notes and Tasks subpages](ui/notes-subpages-2026-11-15/HANDOFF.md) | Reference | Vault Folders reader, editor and task surfaces. |
| [Tool activity](ui/tool-activity/HANDOFF.md) | Reference | Compact tool tree and its visual vocabulary. |
| [Watch Chat](ui/watch-chat/HANDOFF.md) | Reference | Adaptive composer and one Chat entry. |
| [Watch Voice](ui/watch-voice/HANDOFF.md) | Reference | Focused active voice surface. |
| [Opening screen](ui/opening-final-2026-11-14/README.md) | Reference | Selected opening reference and lattice visuals. |
| [Lattice inventory](ui/cognitive-lattice-inventory.md) | Reference | Shared orb asset and renderer map. |
| [Centred stage](ui/centred-stage/README.md) | Reference | Selected web composition and visual examples. |
| [Chat and Voice board](ui/chat-voice/README.md) | Reference | Early comparative Chat and Voice compositions. |
| [Shell styling board](ui/shell-styling/README.md) | Reference | Workspace and conversation glass composition. |
| [Software Factory](ui/software-factory/README.md) | Reference | Agreed Factory hierarchy and fixture evidence. |
| [Factory refresh](ui/factory-refresh-fix/README.md) | Historical | Screenshots from the Factory refresh correction. |
| [Early UI concepts](ui/concepts/README.md) | Historical | Alternative visual directions and HTML concept boards. |
| [P12-36 audit](ui/p12-36/audit.md) | Historical | Daily responsive consistency audit. |
| [P12-37 audit](ui/p12-37/audit.md) | Historical | Daily accessibility and keyboard audit. |
| [P14-12 screenshots](ui/p14-12/screenshots.md) | Historical | Colour and contrast fixture evidence. |
| [P14-41 audit](ui/p14-41/audit.md) | Historical | Dated shared surface and control audit. |
| [iOS board](ios/design/board.html) | Historical | Native design board; not a running app. |
| [iOS surfaces](ios/design/surfaces.html) | Historical | Native surface design explorations. |
| [iOS Today](ios/design/today.html) | Historical | Early Today composition board. |
| [iOS workspaces](ios/design/workspaces.html) | Historical | Earlier native workspace layout. |

Screenshot sidecars stay beside their images and fixtures:

| Document | Status | Evidence |
| --- | --- | --- |
| [1296](ui/screenshots/1296/README.md) | Historical | Camera and conversation surface. |
| [1301](ui/screenshots/1301/README.md) | Historical | Settled glass states. |
| [1304](ui/screenshots/1304/README.md) | Historical | Preview controls and resumed video. |
| [1305](ui/screenshots/1305/README.md) | Historical | Native-sized web preview evidence. |
| [1306](ui/screenshots/1306/README.md) | Historical | Attachment chooser and sources. |
| [1309](ui/screenshots/1309/README.md) | Historical | Desktop composer parity. |
| [1315](ui/screenshots/1315/README.md) | Historical | Mobile Send focus. |
| [1317](ui/screenshots/1317/README.md) | Historical | Unified video delivery. |
| [1319](ui/screenshots/1319/README.md) | Historical | Composer Plus readability. |
| [1321](ui/screenshots/1321/README.md) | Historical | Structured meal estimate layout. |
| [Chat bubble frost](ui/screenshots/chat-bubble-frost/README.md) | Historical | User bubble glass treatment. |
| [Composer focus](ui/screenshots/composer-control-focus/README.md) | Historical | Controls while typing or focused. |
| [Composer sizing](ui/screenshots/composer-sizing/README.md) | Historical | Shared control alignment and spacing. |
| [1343 UI fixes](ui/screenshots/fix-eight-1343/README.md) | Historical | Eight mobile fixes and their current-at-the-time evidence. |
| [iPhone keyboard 1295](ui/screenshots/iphone-keyboard-1295/README.md) | Historical | Web keyboard and viewport correction. |
| [Mobile Chat-only 1303](ui/screenshots/mobile-chat-only-1303/README.md) | Historical | Single Chat surface and composer. |
| [Mobile Chat scroll](ui/screenshots/mobile-chat-scroll/README.md) | Historical | Scroll and focus fixtures. |
| [Mobile corrections 1293](ui/screenshots/mobile-corrections-1293/README.md) | Historical | Dated mobile fixes and screenshots. |
| [Orb and workspace polish](ui/screenshots/orb-folio-polish/README.md) | Historical | Earlier orb and workspace motion evidence. |
| [P9-1283](ui/screenshots/p9-1283/README.md) | Historical | P9 visual fixture capture. |
| [Send diagnostic](ui/screenshots/send-diagnostic/README.md) | Historical | Temporary mobile Send investigation. |
| [Startup navigation 1299](ui/screenshots/startup-navigation-1299/README.md) | Historical | Startup and navigation evidence. |
| [Workspace content](ui/screenshots/workspace-content/README.md) | Historical | Text, file and result presentation fixtures. |

## Prototype material

Code, licenses and instructions for retained prototypes stay together. None of these is the production implementation.

| Document | Status | Use it for |
| --- | --- | --- |
| [Reference inventory](reference/README.md) | Reference | What was imported and where to find the original prototypes. |
| [Coding sandbox README](reference/coding-sandbox-prototype/README.md) | Historical | Old sandbox setup and evidence. |
| [Coding sandbox goal](reference/coding-sandbox-prototype/GOAL.md) | Historical | Original prototype acceptance criteria. |
| [Coding sandbox report](reference/coding-sandbox-prototype/REPORT.md) | Historical | Findings from the first prototype. |
| [Coding sandbox build report](reference/coding-sandbox-prototype/BUILD-REPORT.md) | Historical | Build and toolchain findings. |
| [Coding sandbox restart report](reference/coding-sandbox-prototype/RESTART-REPORT.md) | Historical | Restart and persistence results. |
| [.NET sample build prompt](reference/coding-sandbox-prototype/buildtest/dotnet-agent-prompt.md) | Historical | Synthetic prompt for the retained build test. |
| [Daily snapshot README](reference/daily-v182/README.md) | Reference | Imported Daily contract and evidence map. |
| [Daily API snapshot](reference/daily-v182/daily-api.md) | Reference | Retained endpoint contract. |
| [Daily schema snapshot](reference/daily-v182/daily-schema.md) | Reference | Retained data schema and lineage. |
| [Daily source contract](reference/daily-v182/daily-source-contract.md) | Reference | Sources and accepted evidence for the snapshot. |
| [Daily delivery status](reference/daily-v182/delivery-status.md) | Historical | Status at the time of the snapshot. |
| [Source-to-Jarvis matrix](reference/daily-v182/source-to-jarvis-matrix.md) | Reference | Mapping from legacy Daily to Jarvis. |
| [UI stage prototype](reference/ui-stage-prototype/README.md) | Historical | Stage experiment and how to open it. |
| [Vite license](reference/ui-stage-prototype/licenses/vite-LICENSE.md) | Reference | License for the retained prototype dependency. |
| [Voice prototype README](reference/voice-prototype/README.md) | Historical | Old Voice experiment and setup. |
| [Voice prototype goal](reference/voice-prototype/GOAL.md) | Historical | Original realtime Voice criteria. |
| [Voice prototype report](reference/voice-prototype/REPORT.md) | Historical | Bilingual, interrupt and device findings from the prototype. |

## Archive

Use the snapshots for previous detail, not as active instructions. The pre-refresh Git revision retains the original text. Archive copies rebase links and omit protected values.

| Snapshot | Status | Covers |
| --- | --- | --- |
| [Architecture, October–November 2026](archive/architecture-2026-10-03-to-2026-11-22.md) | Historical | Detailed system designs, diagrams and deployment history. |
| [Agent context, October–November 2026](archive/agent-context-2026-10-03-to-2026-11-22.md) | Historical | Dated operator notes, original checks and recovery history. |
| [Design, October–November 2026](archive/design-2026-10-03-to-2026-11-22.md) | Historical | Per-build feedback, earlier concepts and dated evidence. |

### Investigations and proposals

| Document | Status | Subject |
| --- | --- | --- |
| [Approval cleanup](archive/approval-cleanup-2026-11-10.md) | Historical | November cleanup and its checks. |
| [Approval friction review](archive/approval-friction-review.md) | Historical | Earlier audit of unnecessary approvals. |
| [Copilot runtime recovery](archive/copilot-runtime-recovery-2026-11-07.md) | Historical | Recovery notes for an older runtime. |
| [Health read coverage](archive/daily-health-read-coverage.md) | Historical | Dated tool/API gap inventory. |
| [Factory concurrency correction](archive/factory-concurrency-correction.md) | Historical | Correction to the earlier worker sizing approach. |
| [Factory worker delivery](archive/factory-worker-delivery-2026-11-08.md) | Historical | November handoff of worker delivery. |
| [Main Chat harness migration](archive/main-chat-harness-migration.md) | Historical | Proposal and staged path before PI. |
| [Managed Chat adapter](archive/managed-chat-adapter.md) | Historical | Comparison adapter design and outcomes. |
| [Managed Chat provisioning](archive/managed-chat-provisioning.md) | Historical | Provisioning evidence for the isolated comparison. |
| [Managed policy client](archive/managed-policy-client.md) | Historical | Earlier policy verification and handoff. |
| [Productivity blocker review](archive/productivity-blocker-review.md) | Historical | Dated list of blockers and follow-up work. |
| [Push-to-Chat continuity](archive/push-chat-continuity.md) | Historical | Earlier notification navigation and approval design. |
| [PR 1343 review fixes](archive/review-fixes-1343.md) | Historical | Dated review findings and fixes. |
| [Runtime comparison owner test](archive/runtime-comparison-owner-test.md) | Historical | Historical owner test procedure and limitations. |
| [Runtime lifecycle comparison](archive/runtime-lifecycle-comparison.md) | Historical | Comparison of older lifecycle paths. |
| [Scaffold approval recovery](archive/scaffold-approval-recovery.md) | Historical | Dated recovery investigation. |
| [Settings smoke 1350](archive/smoke-settings-1350.md) | Historical | Old Settings and runtime smoke evidence. |
| [UI audit](archive/ui-audit.md) | Historical | Dated UI findings and recommendations. |
| [UI implementation coverage](archive/ui-implementation-coverage.md) | Historical | Historical review of UI and fixture coverage. |

### iOS builds and visual checks

| Document | Status | Subject |
| --- | --- | --- |
| [Build 87 checks](archive/ios/design/build87-owner-checks.md) | Historical | Device acceptance for that build. |
| [Home brief handoff](archive/ios/design/home-brief-activity-handoff.md) | Historical | Design and validation record for the earlier Home change. |
| [P15-92 verification](archive/ios/design/p15-92-verification.md) | Historical | Shared page pattern evidence. |
| [P15-93 verification](archive/ios/design/p15-93-verification.md) | Historical | Native Notes evidence. |
| [P15-94 verification](archive/ios/design/p15-94-verification.md) | Historical | Home and Factory alignment evidence. |
| [P15-95 verification](archive/ios/design/p15-95-verification.md) | Historical | Health board alignment evidence. |
| [P15-96 verification](archive/ios/design/p15-96-verification.md) | Historical | Insights alignment evidence. |
| [Body trend feedback](archive/ios/design/p15-body-trend-feedback.md) | Historical | Dated native chart feedback. |
| [Build 76 surfaces](archive/ios/design/p15-build76-surfaces.md) | Historical | Native surfaces captured in that build. |
| [Build 79 feedback](archive/ios/design/p15-build79-feedback.md) | Historical | Feedback on Chat and page chrome. |
| [Build 80 release](archive/ios/design/p15-build80-release.md) | Historical | Build contents and device checks. |
| [Build 81 release](archive/ios/design/p15-build81-release.md) | Historical | Build contents and device checks. |
| [Build 84 release](archive/ios/design/p15-build84-release.md) | Historical | Build contents and device checks. |
| [Build 85 release](archive/ios/design/p15-build85-release.md) | Historical | Build contents and device checks. |
| [Build 86 release](archive/ios/design/p15-build86-release.md) | Historical | Build contents and device checks. |
| [Build 89 release](archive/ios/design/p15-build89-release.md) | Historical | Build contents and device checks. |
| [Chat and Settings feedback](archive/ios/design/p15-chat-settings-feedback.md) | Historical | Native Chat and Settings correction evidence. |
| [6 November device feedback](archive/ios/design/p15-device-feedback-2026-11-06.md) | Historical | Observations from the owner test. |
| [Home hierarchy feedback](archive/ios/design/p15-home-hierarchy-feedback.md) | Historical | Earlier Home chrome refinements. |
| [Home stream recovery](archive/ios/design/p15-home-stream-recovery.md) | Historical | Dated recovery evidence. |
| [Integration verification](archive/ios/design/p15-integration-verification.md) | Historical | Native integration evidence and gaps at that time. |
| [Owner test checklist](archive/ios/design/p15-owner-test-checklist.md) | Historical | Original native acceptance checklist. |
| [6 November release](archive/ios/design/p15-release-2026-11-06.md) | Historical | Contents and verification of that release. |
| [Settings verification](archive/ios/design/p15-settings-verification.md) | Historical | Native Settings verification snapshot. |
| [Widget feedback](archive/ios/design/p15-widget-feedback.md) | Historical | Contrast and task widget review. |
