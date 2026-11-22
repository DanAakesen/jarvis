# Project plan

## Current state (2026-11-22)

### Current focus

| Priority | Outcome |
| --- | --- |
| **P0** | Every tool, whether a harness built-in or a Jarvis tool, works the same in Chat and Voice, without errors. Start with [the daily-core acceptance issue #2012](https://github.com/DanAakesen/jarvis/issues/2012). |
| **P1** | Proactive intelligence: Jarvis reaches out when a signal needs attention, with the context that makes it relevant. See [#2011](https://github.com/DanAakesen/jarvis/issues/2011). |
| **P2** | Polish and everything else. |

These are priority ranks, not the historical phase IDs. Dan's daily core, in order: **1. Jarvis project** (issues, PRs, workers, releases), **2. Notes**, **3. Tasks**, **4. Workouts**, **5. Nutrition** when logging food (kcal logged and left today, protein still needed), **6. Banking** later (see F).

| Delivery | State |
| --- | --- |
| **Notes [#2031](https://github.com/DanAakesen/jarvis/pull/2031)** | Merged at `ee34f2c3e`. Fixes missing new notes, wrong list/pin titles and duplicate headlines. Includes inventory migration `0103`. Dan reports the Notes check passed on build 124. |
| TestFlight **124** | Uploaded from `ee34f2c3e` by [run #124](https://github.com/DanAakesen/jarvis/actions/runs/45071501953). Dan reports tests 1 (project status and issue lookup), 2 (Notes) and 3 (creating and completing a task) passed. The channels were unspecified. Test 7 failed for iPhone Chat typing lag ([#2026](https://github.com/DanAakesen/jarvis/issues/2026)). The other checks, including the Voice part of test 7, await feedback. |
| Backend | #2032 (Terra 600K capacity) and #2033 (tool access, rate-limit recovery; the iPhone Gym reads ship in the app) were deployed through [Deploy](https://github.com/DanAakesen/jarvis/actions/runs/45064871117) before build 123/124. [Notes Deploy](https://github.com/DanAakesen/jarvis/actions/runs/45069151013) succeeded from `ee34f2c3e`. Pipeline receipts do not prove live provider behavior. |
| Repository and docs | Tracked files fell from 3,233 to 1.814 and tracked docs to about 3 MB; obsolete notes, handoffs, evidence, screenshots and prototypes are deleted (Git history keeps them). [`.github/copilot-instructions.md`](.github/copilot-instructions.md) is the source of truth and maps the key files; `AGENTS.md` only points to it. `p0.md`, `ui.md` and the key docs were rewritten to the current state. |
| Background PI | Off by default in code; off per the 22 November handoff, not independently read back. Dan controls it in **Settings → Proactive**. The existing 07:00/18:00 engine stays until decision A. |
| CarPlay | Dan reported Apple granted **Voice Based Conversation** on 21 November. Capability activation, implementation and in-car acceptance have not been verified. |

### Next steps and blockers

1. **Dan tests build 124** with the checks below. For any later change, the coordinator (the dispatcher session that reviews and merges PRs) checks that the exact head is current with `main`, required CI is green (including macOS for iOS), no unresolved threads or High findings remain, and the merge tree equals the qualified tree. Follow [Merge and release procedure](docs/agent-context.md#merge-and-release-procedure) and [TestFlight build](docs/agent-context.md#testflight-build). No live probes.
2. **Test build 124 in daily-core order.** Ask the same things in Chat and Voice: project status and a GitHub issue; find, read and save a note (including a title-only note; check first-page visibility, pin title and a single reader headline); complete a task and verify its receipt; find a lift saved from iPhone Gym; read the nutrition totals on a logged day. Ask for weather via the existing conversation. Check iPhone typing, live Voice state/auto-scroll, then Watch dictation/voice and the single Proactive switch. Do not request a retest of a fix still in flight.
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

## Last 8 days (15–22 November 2026)

The 113 merged PR numbers below are from `main`'s first-parent history. A merge records code or documentation delivery, not acceptance on a device or with a live model.

| Theme | What changed | Merged PRs |
| --- | --- | --- |
| **PI rollout and reach** | Designed the managed harness trial, provisioned PI, connected Jarvis MCP, GitHub and Azure, and made PI the default for Chat and Voice. Foundry now owns live agent instructions and voice settings. The earlier replays and smoke tooling are historical evidence or tooling, not instructions to run live tests. | #1852, #1854, #1869, #1873, #1883, #1884, #1890, #1897, #1898, #1901, #1908, #1909, #1910, #1911, #1913, #1914, #1915, #1916, #1917, #1918, #1919, #1936, #1955, #1956, #1961, #1992, #1994, #1998 |
| **P0: tools and turns** | One MCP ledger with replay recognition; native harness work finishes on its own; harden SSE handling, plain failure copy and FIFO turn/cancel behavior. Offline conformance covers the registered Jarvis surface; parity grew from 24 scenarios (27 tests) to 37 scenarios. Danish first-search aliases, truthful write receipts and the 24,000-character read bound stay. #2033 restored the established two-name tool surface and recovers safe rate-limited requests and completed-tool receipts. | #1928, #1996, #1999, #2002, #2003, #2004, #2016, #2017, #2020, #2021, #2022, #2023, #2024, #2030, #2033 |
| **P1: proactive reach-outs** | Event queue, brain and standing watches; durable situational state and follow-ups; wake/Chat tool parity. Add GitHub, failed reminder and calendar-clash signals, tick/skip evidence and named failures. Correct cache accounting, clean up scratch wakes, link reply previews and carry feedback into the next due wake. Legacy slots remain. | #1862, #1904, #1906, #1907, #1964, #1986, #2014, #2018, #2019, #2025 |
| **Vault, Loose Ends and Memory** | Build the Vault-backed capture/index/tools/nudge loop and cut over to one vault layout. Restore authoritative mirror evidence. Keep SQL Personal Memory separate from Vault Knowledge; the iPhone Gym store is visible to the assistant after #2033. | #1848, #1860, #1863, #1864, #1865, #1866, #1867, #1868, #1896, #1912, #1963, #1965, #1983 |
| **iPhone: talk, type and follow** | Native GPT-Live, truthful states/captions, a complete spoken request and barge-in without cancelling PI. Reliable playback-stop receipts, responsive drafts and voice-following Chat with state labels. Exact reply pushes, useful previews and delivery evidence for reminders. | #1984, #1985, #1991, #1993, #1995, #1997, #2000, #2001, #2013, #2027, #2034 |
| **Notes, app UI and design** | Notes/Tasks redesign and folder ordering; native title edit, one Proactive settings panel and Voice gestures. Conversational blocks, Voice previews/carousel, tool tree, graph, orb and design handovers. Notes inventory and title consistency merged in #2031. | #1853, #1893, #1899, #1902, #1921, #1926, #1927, #1930, #1931, #1932, #1933, #1934, #1937, #1947, #1948, #1949, #1953, #1960, #2028, #2031 |
| **Watch** | First-press and dictation work, complication freshness, capture deadlines and formats, healthy route recovery, focused Voice and adaptive Chat composer. | #1857, #1861, #1871, #1938, #1946, #1950, #1951, #1952, #1954, #1959, #2029 |
| **Operations and docs** | Terra capacity set to 600K tokens/min in infrastructure and reported applied in #2032. Updated deployment/usage controls, TestFlight crash feedback and the PI docs. | #1889, #1900, #1929, #2015, #2032 |

## Active issue backlog

Issues stay open until the owner accepts the result, even when the implementation PR is merged. These are existing GitHub issues, not generated phase tasks. Do not create new issues for this table.

| Issue | State at this handoff |
| --- | --- |
| [#2012](https://github.com/DanAakesen/jarvis/issues/2012), [#1967](https://github.com/DanAakesen/jarvis/issues/1967) — daily core and tools | Core fixes merged. Verify daily-core behavior after the release. |
| [#1988](https://github.com/DanAakesen/jarvis/issues/1988) — GPT-Live sounds and behaves like Jarvis | Whole spoken turn, relay and state fixes merged. Physical and provider acceptance open. |
| [#2011](https://github.com/DanAakesen/jarvis/issues/2011) — proactive companion | Queue, observability and feedback merged. Dan's first enabled wake and delivery acceptance open. |
| [#2005](https://github.com/DanAakesen/jarvis/issues/2005) — Notes titles | Editing merged in #2028 and first-page visibility and consistent titles in #2031. Dan reports test 2 passed. Editing an existing title was outside that check. |
| [#2010](https://github.com/DanAakesen/jarvis/issues/2010), [#2026](https://github.com/DanAakesen/jarvis/issues/2026) — truthful Chat status and typing | Build 124 still lags during typing after #2027 and #2034. The follow-up narrows draft observation, removes redundant editor layout and moves the screen-share heartbeat read off the UI thread. Pending an Apple build and device timing. |
| [#2007](https://github.com/DanAakesen/jarvis/issues/2007), [#2008](https://github.com/DanAakesen/jarvis/issues/2008) — Proactive and Voice controls | #2028 and #2034 merged. Device acceptance open. |
| [#2006](https://github.com/DanAakesen/jarvis/issues/2006) — Watch reliability | #2029 merged. Verify first dictation, recovery and stable Voice on Watch. |
| [#1971](https://github.com/DanAakesen/jarvis/issues/1971) — incremental refresh, search and delivery | Open. Track responsiveness and freshness separately from a successful response. |
| [#2009](https://github.com/DanAakesen/jarvis/issues/2009) — Foundry administration | Scope decision E. |
| [#1972](https://github.com/DanAakesen/jarvis/issues/1972), [#1973](https://github.com/DanAakesen/jarvis/issues/1973) — verified dead code | Open. No broad deletion until the replacement and relevant contracts are qualified. |

## Recently completed phase tasks

Next available P15 task ID: `P15-212`. Check the plan, archive and GitHub issues before assigning it.

These completed phase tasks have existing GitHub issues and merged PRs from the last eight days. `Complete` means task delivery, not physical acceptance. Add new numbered tasks with the same columns; priority issues such as `P0: …` stay in the backlog above, not as invented task IDs.

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
