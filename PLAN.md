# Project plan

## Current state

### Current focus

| Priority | Outcome |
| --- | --- |
| **P0** | Every tool, whether a harness built-in or a Jarvis tool, works the same in Chat and Voice, without errors. Start with [the daily-core acceptance issue #2012](https://github.com/DanAakesen/jarvis/issues/2012). |
| **P1** | Proactive intelligence: Jarvis reaches out when a signal needs attention, with the context that makes it relevant. See [#2011](https://github.com/DanAakesen/jarvis/issues/2011). |
| **P2** | Polish and everything else. |

**In flight:** The [build 124 follow-up (#2043)](https://github.com/DanAakesen/jarvis/pull/2043) covers Chat resume and typing, target settings, Watch audio and PI. Build 124 does not contain those fixes; wait for an installable build that does before requesting a retest of them.

These are priority ranks, not the historical phase IDs. Dan's daily core, in order: **1. Jarvis project** (issues, PRs, workers, releases), **2. Notes**, **3. Tasks**, **4. Workouts**, **5. Nutrition** when logging food (kcal logged and left today, protein still needed), **6. Banking** later (see F).

| Delivery | State |
| --- | --- |
| TestFlight **124** | [Export and upload succeeded](https://github.com/DanAakesen/jarvis/actions/runs/45071501953) from `ee34f2c3e`. Includes the native Notes title and list updates ([#2031](https://github.com/DanAakesen/jarvis/pull/2031)), live Voice follow and status ([#2034](https://github.com/DanAakesen/jarvis/pull/2034)), and Watch recovery ([#2029](https://github.com/DanAakesen/jarvis/pull/2029)). Apple processing and tester availability are unverified; **not accepted on device**. |
| Backend | The [latest main Deploy](https://github.com/DanAakesen/jarvis/actions/runs/45078026398) has an accepted release receipt and passed deterministic runtime readiness. Its source includes the [Notes release](https://github.com/DanAakesen/jarvis/actions/runs/45069151013) with migration `0103`, the PI rate-limit and tool-access fixes, and `gym_lifts` discovery of iPhone Gym records. The manual live acceptance job did not run. |
| Background PI | Off by default in code; production setting not read back. Dan controls it in **Settings → Proactive**. The old engine stays until decision A. |
| CarPlay | Dan reported Apple granted **Voice Based Conversation** on 21 November. Capability activation, implementation and in-car acceptance have not been verified. |

### Next steps and blockers

1. **Confirm build 124 is installable** before requesting a retest. Use the [TestFlight procedure](docs/agent-context.md#testflight-build); do not dispatch a build or run live probes to verify this plan.
2. **Test build 124 in daily-core order once available.** Ask the same things in Chat and Voice: project status and a GitHub issue; find, read and save a note (including a title-only note; check first-page visibility, pin title and a single reader headline); complete a task and verify its receipt; find a lift saved from iPhone Gym; read the nutrition totals on a logged day. Ask for weather via the existing conversation. Then check live Voice state/auto-scroll, Watch dictation/voice and the single Proactive switch. Do not request a retest of a fix still in flight.
3. **P1 after P0.** Dan decides when to enable Background PI. Verify the intended GitHub App event subscriptions (including `Release`) and observe one real wake with its signal, decision, and exact-message delivery before considering legacy deletion. The queue has GitHub, failed-reminder and calendar-clash signals. The heavy-snow/travel example is an acceptance goal, not a shipped end-to-end scenario.

**Unverified:** whether Foundry sends a usable `_meta` call ID (the ledger still works without one); whether an existing provider conversation picks up restored tool access without a reset (Jarvis does not ask for one); real provider rate-limit message and cause (reported error code and offline fixtures are evidence, not a new live trace); iPhone follow/Voice label and Watch recovery on physical devices; real Background PI wake and delivery. Do not treat an offline replay or a merged fix as device acceptance.

### Open decisions A–F

| | Decision needed | Until then |
| --- | --- | --- |
| **A** | When to delete the old 07:00/18:00 proactive engine. | Keep it instrumented. Wait for one proven brain wake and Dan's decision. Deletion is parked at `1d912cda` on `danaakesen-shiny-carnival-engine-deletion`; not ready to merge. See [cutover gates](docs/pi/cutover.md). |
| **B** | Should the Nutrition screen allow direct manual kcal entry? | Keep logging through the supported Food/Chat/Voice flow. Do not infer that manual entry shipped. |
| **C** | Should long PI conversations be compacted? | Reported tool turns carried 84K–116K input tokens; the fresh instructions baseline was about 18K. Provider history is a plausible contributor, not an itemised measurement. No reset, pruning or compaction until the managed endpoint and context retention are verified. |
| **D** | P1-5: what could be removed from the PI instructions? | Dan owns the Foundry edit and activation. Keep the `KEEP THIS BLOCK` tool contract. |
| **E** | Which Foundry admin operations should Jarvis expose? | [#2009](https://github.com/DanAakesen/jarvis/issues/2009): first compare with existing `az_` tools; scope instructions, versions/activation, models and deployments before adding writes. |
| **F** | What approval applies when banking can move money? | Banking is out of scope. Ask Dan before implementing or performing anything that moves money; do not extrapolate the PI DELETE rule to banking. |

## Active issue backlog

Issues stay open until the owner accepts the result, even when the implementation PR is merged. These are existing GitHub issues, not generated phase tasks. Do not create new issues for this table.

| Issue | What remains |
| --- | --- |
| [#2012](https://github.com/DanAakesen/jarvis/issues/2012), [#1967](https://github.com/DanAakesen/jarvis/issues/1967) — daily core and tools | Core fixes merged; not accepted on device. |
| [#1988](https://github.com/DanAakesen/jarvis/issues/1988) — GPT-Live sounds and behaves like Jarvis | Whole spoken turn, relay and state fixes merged. Physical and provider acceptance open. |
| [#2011](https://github.com/DanAakesen/jarvis/issues/2011) — proactive companion | Queue, observability and feedback merged. Dan's first enabled wake and delivery acceptance open. |
| [#2005](https://github.com/DanAakesen/jarvis/issues/2005) — Notes titles | Not accepted on device: edit, first-page visibility and consistent titles. |
| [#2010](https://github.com/DanAakesen/jarvis/issues/2010) — truthful Chat status | Not accepted on device: verify reply status and live Voice follow. |
| [#2026](https://github.com/DanAakesen/jarvis/issues/2026) — iPhone Chat typing | Draft isolation is merged ([#2027](https://github.com/DanAakesen/jarvis/pull/2027)). Issue still in progress; not accepted on device. The check is quick typing with no visible lag or dropped characters and smooth scrolling in a conversation with 100+ messages. |
| [#2007](https://github.com/DanAakesen/jarvis/issues/2007), [#2008](https://github.com/DanAakesen/jarvis/issues/2008) — Proactive and Voice controls | Not accepted on device: single switch, caption scrolling and panel controls. |
| [#2006](https://github.com/DanAakesen/jarvis/issues/2006) — Watch reliability | Not accepted on device: first dictation, recovery and stable Voice. |
| [#1971](https://github.com/DanAakesen/jarvis/issues/1971) — incremental refresh, search and delivery | Open. Track responsiveness and freshness separately from a successful response. |
| [#2009](https://github.com/DanAakesen/jarvis/issues/2009) — Foundry administration | Scope decision E. |
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
