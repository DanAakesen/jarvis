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
| TestFlight **124** | [Upload](https://github.com/DanAakesen/jarvis/actions/runs/45071501953) from `ee34f2c3e`. Dan passed project and issue lookup, Notes, task create/complete, weather in the ongoing conversation and the single Proactive switch (tests 1–3, 6 and 9). iPhone typing lag, phone location, both target settings pages, Watch dictation and Watch Voice failed. Gym, Nutrition totals and Voice caption scrolling still need device checks. Channel parity remains open. |
| Backend | The [latest main Deploy](https://github.com/DanAakesen/jarvis/actions/runs/45078026398) has an accepted release receipt and passed deterministic runtime readiness. Its source includes the [Notes release](https://github.com/DanAakesen/jarvis/actions/runs/45069151013) with migration `0103`, the PI rate-limit and tool-access fixes, and `gym_lifts` discovery of iPhone Gym records. The manual live acceptance job did not run. |
| Background PI | Dan turned it on in build 124. The Proactive page shows turns used, allowance and last activation. A real GitHub workflow failure triggered a successful review on 23 November. It sent no message. Device delivery awaits verification. |
| CarPlay | Dan reported Apple granted **Voice Based Conversation** on 21 November. Capability activation, implementation and in-car acceptance have not been verified. |

### Next steps and blockers

1. On the next build, retest typing while Jarvis replies and ask for the iPhone location from the same conversation. Verify the single switch on the main Settings page.
   Open Training targets and Nutrition targets. Build 124 showed a load error on both. Both server responses passed a production shape check. On iPhone, verify the fields load, save one intended change and reopen each page. Report the exact message if a page still fails.
2. On a day with logged data, compare the iPhone Gym lift and Nutrition totals in Chat and Voice. Test Voice caption scrolling, status and Watch dictation/reconnection. Build 124 results above cover only the channels Dan reported.
3. On iPhone, find a nearby pharmacy, select a match and open Directions. In Voice, ask when to leave for an event with an address and a ten-minute buffer. Check the spoken estimate against the card.
4. Verify an ordinary Inbox follow-up and its delivery. See [Inbox acceptance](docs/inbox-loop/acceptance.md).

**Unverified:** whether Foundry sends a usable `_meta` call ID (the ledger still works without one); real provider rate-limit message and cause (reported error code and offline fixtures are evidence, not a new live trace); iPhone follow/Voice label and Watch recovery on physical devices; Background PI message delivery. Do not treat an offline replay or a merged fix as device acceptance.

Backend diagnostics use a backend-only log grant. Verify production readback and one owner request before accepting. See [log access](docs/reference/logs.md).

### Open decisions A–F

| | Decision | Next check |
| --- | --- | --- |
| **A** | Legacy proactive engine removal approved. | PI owns the slots. Verify capture and a qualifying follow-up in production. |
| **B · decided** | Manual kcal adds one meal on iPhone. | Device check: in Health → Nutrition, log 100 kcal. Meals should gain one entry and Chat should report 100 more kcal for today. |
| **C** | How and when should PI compact context within the one ongoing conversation? | Reported tool turns carried 84K–116K input tokens; the fresh instructions baseline was about 18K. Dan confirmed compaction is needed. Verify managed-endpoint support and context retention before implementation. |
| **D** | P1-5: what could be removed from the PI instructions? | Dan owns the Foundry edit and activation. Keep the `KEEP THIS BLOCK` tool contract. |
| **E** | Foundry administration is approved. | [#2009](https://github.com/DanAakesen/jarvis/issues/2009) covers instructions, versions, activation, models and deployments. Live acceptance is open. |
| **F** | Banking stays out of scope. | No banking implementation or money movement. |

## Active issue backlog

Issues stay open until the owner accepts the result, even when the implementation PR is merged. These are existing GitHub issues, not generated phase tasks. Do not create new issues for this table.

| Issue | What remains |
| --- | --- |
| [#2012](https://github.com/DanAakesen/jarvis/issues/2012), [#1967](https://github.com/DanAakesen/jarvis/issues/1967) — daily core and tools | Build 124 passed the project, Notes, task and weather checks. Workout, Nutrition and full Chat/Voice parity still need device checks. |
| [#1988](https://github.com/DanAakesen/jarvis/issues/1988) — GPT-Live sounds and behaves like Jarvis | Whole spoken turn, relay and state fixes merged. Physical and provider acceptance open. |
| [#2011](https://github.com/DanAakesen/jarvis/issues/2011) — proactive companion | Queue, observability and feedback merged. First enabled GitHub-triggered review verified. Delivery of an actual suggestion remains open. |
| [#2005](https://github.com/DanAakesen/jarvis/issues/2005) — Notes titles | Editing merged in #2028 and first-page visibility and consistent titles in #2031. Dan reports test 2 passed. Editing an existing title was outside that check. |
| [#2010](https://github.com/DanAakesen/jarvis/issues/2010), [#2026](https://github.com/DanAakesen/jarvis/issues/2026) — truthful Chat status and typing | Build 124 still lags during typing after #2027 and #2034. The follow-up narrows draft observation, removes redundant editor layout and moves the screen-share heartbeat read off the UI thread. Chat also reattaches to the original reply after backgrounding. Retest typing and app switching on iPhone. |
| [#2007](https://github.com/DanAakesen/jarvis/issues/2007), [#2008](https://github.com/DanAakesen/jarvis/issues/2008) — Proactive and Voice controls | Build 124 test 9 passed. Dan wants the single Proactive suggestions switch directly on the main Settings page. The inline control awaits device acceptance. Voice gesture acceptance remains open. |
| [#2006](https://github.com/DanAakesen/jarvis/issues/2006) — Watch reliability | Build 124 failed dictation and Voice. Both dictation uploads reached the backend. Retest the Speech handshake fix, then start Voice and verify two-way audio after Listening. |
| [#1971](https://github.com/DanAakesen/jarvis/issues/1971) — incremental refresh, search and delivery | Chat counts streamed bytes as they arrive. Busy Home briefs keep urgent tasks and upcoming meetings. Chat and Voice can return a local repository reader while GitHub tools load. Provider sync remains open. |
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
