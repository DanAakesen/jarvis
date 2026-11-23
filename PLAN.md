# Project plan

## Current state

### Current focus

| Priority | Outcome |
| --- | --- |
| **P0** | Every tool, whether a harness built-in or a Jarvis tool, works the same in Chat and Voice, without errors. Start with [the daily-core acceptance issue #2012](https://github.com/DanAakesen/jarvis/issues/2012). |
| **P1** | Proactive intelligence: Jarvis reaches out when a signal needs attention, with the context that makes it relevant. See [#2011](https://github.com/DanAakesen/jarvis/issues/2011). |
| **P2** | Polish and everything else. |

These are priority ranks, not the historical phase IDs. Dan's daily core, in order: **1. Jarvis project** (issues, PRs, workers, releases), **2. Notes**, **3. Tasks**, **4. Workouts**, **5. Nutrition** when logging food (kcal logged and left today, protein still needed), **6. Banking** later (see F).

| Delivery | State |
| --- | --- |
| TestFlight **126** | [Apple confirmed internal availability](https://github.com/DanAakesen/jarvis/actions/runs/45194610942). Watch, iPhone Voice, location and nutrition fixes are **not accepted on device**. Build 125 passed typing, reply recovery, Settings targets and lift readback. |
| Backend | The [covered Inbox slot rollout](https://github.com/DanAakesen/jarvis/actions/runs/45196741421) applied the backend and passed the PI revision check. See Deploy for full readiness; live conversation acceptance is separate. |
| Background PI | The owner enabled it. A GitHub workflow failure triggered a review but no message. Push is **not accepted on device**. |
| CarPlay | Dan reported Apple granted **Voice Based Conversation** on 21 November. Capability activation, implementation and in-car acceptance have not been verified. |

### Next steps and blockers

1. On build 126, check project status and the issue-to-worker flow for approved work in Chat and Voice. Save, find and rename a note; check its iPhone folder without refreshing. Create a task, check its reminder, then complete it. Check workout and lift readback. Log one meal with kcal and optional protein; compare today's totals and remaining kcal in Nutrition, Chat and Voice. Check Danish and English phrasing.
2. Verify iPhone Voice leaves Speaking between replies, and check current location with permission on and off. On Watch, edit dictation before sending, test two audible Voice turns and reconnect, then check the saved turn in Chat.
3. On iPhone, find a nearby pharmacy, pick a match and open Directions. In Voice, ask when to leave for an event with an address and a ten-minute buffer. Compare the spoken estimate with the map card.
4. Verify an ordinary Inbox follow-up against its linked card, then check device delivery separately. An event can cover a scheduled slot even if it used the last daily PI turn. See [Inbox acceptance](docs/inbox-loop/acceptance.md) for review eligibility and the import cooldown.

**Unverified:** a usable Foundry `_meta` call ID for replay, the live provider rate-limit cause, and Background PI message delivery. Offline replay and merged code do not establish device acceptance.

### Open decisions A–F

| | Decision | Next check |
| --- | --- | --- |
| **A · decided** | PI owns scheduled reviews; the legacy slot runner is gone. The separate legacy event consumer is not the PI queue path. | Verify capture and a qualifying follow-up in production. |
| **B · decided** | Manual entry adds one meal with kcal and optional protein on iPhone. | Check that one save counts once and Today agrees with Chat for the same activity and meals. |
| **C** | Keep the same stored conversation for Chat and Voice. Foundry controls context management on this endpoint. | Revisit configurable compaction when the [Copilot harness](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/limits-quotas-regions#microsoft-copilot-harness-preview) supports it. |
| **D** | P1-5: what could be removed from the PI instructions? | Dan owns the Foundry edit and activation. Keep the `KEEP THIS BLOCK` tool contract. |
| **E** | Foundry administration is approved. | [#2009](https://github.com/DanAakesen/jarvis/issues/2009) covers instructions, versions, activation, models and deployments. Live acceptance is open. |
| **F** | Banking stays out of scope. | No banking implementation or money movement. |

## Active issue backlog

Issues stay open until the owner accepts the result, even when the implementation PR is merged. These are existing GitHub issues, not generated phase tasks. Do not create new issues for this table.

| Issue | What remains |
| --- | --- |
| [#2012](https://github.com/DanAakesen/jarvis/issues/2012), [#1967](https://github.com/DanAakesen/jarvis/issues/1967) — daily core and tools | Run the daily-core checks above on the current build. Lift readback passed on iPhone. Nutrition and full Chat/Voice parity still need device checks. |
| [#1988](https://github.com/DanAakesen/jarvis/issues/1988) — GPT-Live sounds and behaves like Jarvis | Whole spoken turn, relay and state fixes merged. Physical and provider acceptance open. |
| [#2011](https://github.com/DanAakesen/jarvis/issues/2011) — proactive companion | Queue, observability and feedback merged. First enabled GitHub-triggered review verified. Delivery of an actual suggestion remains open. |
| [#2005](https://github.com/DanAakesen/jarvis/issues/2005) — Notes titles | Rename an existing note, then verify the saved title in Notes, Pinned, the reader and links. Editing an existing title is **not accepted on device**. |
| [#2010](https://github.com/DanAakesen/jarvis/issues/2010) — truthful Chat status | Returning during a reply passed on build 125. Check failed, cancelled and superseded states in the separate reply test. |
| [#2026](https://github.com/DanAakesen/jarvis/issues/2026) — iPhone Chat typing | Typing during a reply passed on Dan’s iPhone on build 125. |
| [#2007](https://github.com/DanAakesen/jarvis/issues/2007), [#2008](https://github.com/DanAakesen/jarvis/issues/2008) — Proactive and Voice controls | Proactive settings and caption scrolling passed on build 125. The Voice activity label still needs a device retest. |
| [#2006](https://github.com/DanAakesen/jarvis/issues/2006) — Watch reliability | The editable draft, playback receipts and saved-turn recovery are in build 126; **not accepted on device**. |
| [#1971](https://github.com/DanAakesen/jarvis/issues/1971) — incremental refresh, search and delivery | Chat counts streamed bytes as they arrive. Busy Home briefs keep urgent tasks and upcoming meetings. Short citations preserve full Calendar event IDs within the existing model limits. Chat and Voice can return a local repository reader while GitHub tools load. Gmail refreshes unread membership each poll and reuses immutable message headers within the current authorization. Calendar covers the next 48 hours and Travel days 3–7. Paged reads keep one query through the result limit. Cross-poll Calendar sync remains open. |
| [#2009](https://github.com/DanAakesen/jarvis/issues/2009) — Foundry administration | Ask “show my Foundry agents”, then read the serving version and its model. Verify a version change on a test agent when authorized. |
| [#1972](https://github.com/DanAakesen/jarvis/issues/1972), [#1973](https://github.com/DanAakesen/jarvis/issues/1973) — verified dead code | Open. No broad deletion until the replacement and relevant contracts are qualified. |

## Recently completed phase tasks

Next available P15 task ID: `P15-212`. Check the plan, archive and GitHub issues before assigning it.

`Complete` means task delivery, not physical acceptance. Add new numbered tasks with the same columns; priority issues such as `P0: …` stay in the backlog above, not as invented task IDs.

| ID | Issue | Task | Acceptance criteria | Depends on | Status |
| --- | --- | --- | --- | --- | --- |
| P15-143 | [#1834](https://github.com/DanAakesen/jarvis/issues/1834) | Cognitive lattice orb, opening screen and app icon (#1853) | Shared orb and opening design merged. | — | Complete |
| P15-160 | [#1856](https://github.com/DanAakesen/jarvis/issues/1856) | Watch first-press dictation and voice (#1857) | Capture/start regressions addressed; later Watch acceptance tracked in #2006. | — | Complete |
| P15-162 | [#1859](https://github.com/DanAakesen/jarvis/issues/1859) | Refresh the Watch steps complication (#1861) | Steps use the refreshed complication data path. | — | Complete |
| P15-174 | [#1885](https://github.com/DanAakesen/jarvis/issues/1885) | Provision the PI agent, MCP and initial iOS Chat (#1890, #1897, #1898) | Managed harness provisioning and initial Chat path merged. | — | Complete |
| P15-175 | [#1886](https://github.com/DanAakesen/jarvis/issues/1886) | Add PI reach, brain loop and standing watches (#1901, #1904, #1906) | Core reach and wake paths merged; subsequent decisions and live switch tracked separately. | — | Complete |
| P15-180 | [#1894](https://github.com/DanAakesen/jarvis/issues/1894) | Redesign Notes and Tasks (#1899) | Native pages, note reader, editor and recovery merged. | — | Complete |
| P15-183 | [#1920](https://github.com/DanAakesen/jarvis/issues/1920) | Set manual Notes folder order (#1921) | Owner's folder order persists rather than living only on one device. | — | Complete |
| P15-186 | [#1924](https://github.com/DanAakesen/jarvis/issues/1924) | Design the 3D Vault graph (#1926, #1932) | Design and rendered graph merged. | — | Complete |
| P15-187 | [#1925](https://github.com/DanAakesen/jarvis/issues/1925) | Design the Jarvis iPhone sheet and generated content (#1927, #1931, #1933, #1934) | Agreed handover; conversational blocks and Voice bottom panel merged. | — | Complete |
| P15-195 | [#1940](https://github.com/DanAakesen/jarvis/issues/1940) | Make graph titles and links readable (#1948) | Long-title wrapping and clearer link lines merged. | — | Complete |
| P15-200 | [#1945](https://github.com/DanAakesen/jarvis/issues/1945) | Focus the Watch active Voice view (#1946, #1952) | Watch Voice focus design and implementation merged. | — | Complete |

[Plan status](.github/workflows/plan-status.yml) reconciles only this file's numbered rows. On a plan push or manual run it creates issues for new IDs and resolves `Depends on` by issue title against **all** GitHub issues, including closed ones. It does not need archived rows to find their issues. The archive is not a work queue; do not reuse its IDs. Keep the Issue/Status columns and issue checklist links to [Development workflow](docs/agent-context.md#development-workflow), [Start a task](docs/agent-context.md#start-a-task) and [Finish a task](docs/agent-context.md#finish-a-task) intact.
