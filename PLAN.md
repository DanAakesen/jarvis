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
| P15-212 · [Combined mobile release](https://github.com/DanAakesen/jarvis/pull/2084) | Build 137 includes the fixed Voice orb and swipeable windows, Calendar gestures, orb themes, shared Card glow, Body trend and monthly All history. The new behaviour is **not accepted on device**. |
| TestFlight **137** | [Apple confirmed internal availability](https://github.com/DanAakesen/jarvis/actions/runs/45663058853). The [signed iPhone archive](https://github.com/DanAakesen/jarvis/actions/runs/45658685353) verified the embedded Watch companion, not Watch installation or playback. |
| Backend | [Deploy for the same source](https://github.com/DanAakesen/jarvis/actions/runs/45655162587) passed startup migrations, PI provisioning and deterministic readiness. Live conversation acceptance was skipped. |
| Background PI | The owner enabled it. A GitHub workflow failure triggered a review but no message. Push is **not accepted on device**. |
| CarPlay | Dan reported Apple granted **Voice Based Conversation** on 21 November. Capability activation, implementation and in-car acceptance have not been verified. |

### Next steps and blockers

Home composer folding and reopening passed on build 135. On 137, recheck the plus-menu icon colour, the iPhone Voice speaker control and scroll edges in short and long Voice panels. With three results open, check spoken previous, next and close after a manual swipe.

1. On the [confirmed TestFlight build](docs/agent-context.md#testflight-build), test the daily core in Chat and Voice: check project status and the issue-to-worker flow for approved work; save, find and rename a note and check its iPhone folder without refreshing; create a task, check its reminder, then complete it; check workout and lift readback in Danish and English. When logging food, save one meal and verify that it counts once. Compare Nutrition Today with Chat and Voice: logged and remaining kcal, resting target, active kcal, deficit and protein still needed. Track remaining Chat and Voice coverage in [#2012](https://github.com/DanAakesen/jarvis/issues/2012).
2. Dictate a short phrase and then a longer message on Watch. Each Stop should put the transcript in the draft once. Start Voice from Watch and confirm it reaches Listening and stays open. Listen to two complete replies on its speaker and interrupt a third. On build 135, Watch Voice failed at startup. iPhone Listening and Speaking passed, but a lookup showed Listening instead of Thinking. Retest both on 137.
3. On iPhone, ask for a named store nearby. A matching local business or an explicit no-match result passes. If none appears, ask explicitly for the nearest and check the match and Directions beyond 10 km. Check that a completed lookup still reports its result if reply writing fails. In Voice, compare the spoken departure estimate with the map card for an event with an address and a ten-minute buffer.
4. Verify an ordinary Inbox follow-up against its linked card, then check device delivery separately. An event can cover a scheduled slot even if it used the last daily PI turn. See [Inbox acceptance](docs/inbox-loop/acceptance.md) for review eligibility and the import cooldown.
5. After a scale reading appears in Apple Health, open Jarvis Health and compare the weight, body fat and measurement date. On Watch Home, scroll through all five sections and check the heading beside the clock in both directions.
6. Opening Calendar from Schedule and matching move/edit results across Day, Week, agenda and Google Calendar passed on build 135. On 137, check the footer and hold-to-create gesture, Up Next, Health cards (monthly All history, Body trend and the separate Training walk count), and Notes tiles. Check a Notes folder move with a Markdown table edit. Try each orb theme without changing display mode; save and reset the finish and glow, and check per-card colours on iPhone. Reconnect Watch and check its palette and tinted complications.

**Unverified:** a usable Foundry `_meta` call ID for replay, the live provider rate-limit cause, and Background PI message delivery. Offline replay and merged code do not establish device acceptance.

### Open decisions A–F

| | Decision | Next check |
| --- | --- | --- |
| **A · decided** | PI owns scheduled reviews; the legacy slot runner is gone. The separate legacy event consumer is not the PI queue path. | Verify capture and a qualifying follow-up in production. |
| **B · decided** | Manual entry adds one meal with kcal and optional protein on iPhone. | Run the Nutrition check above. |
| **C** | Keep the same stored conversation for Chat and Voice. Foundry controls context management on this endpoint. | Revisit configurable compaction when the [Copilot harness](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/limits-quotas-regions#microsoft-copilot-harness-preview) supports it. |
| **D** | P1-5: what could be removed from the PI instructions? | Dan owns the Foundry edit and activation. Keep the `KEEP THIS BLOCK` tool contract. |
| **E** | Foundry administration is approved. | [#2009](https://github.com/DanAakesen/jarvis/issues/2009) covers instructions, versions, activation, models and deployments. Live acceptance is open. |
| **F** | Banking stays out of scope. | No banking implementation or money movement. |

## Active issue backlog

Issues stay open until the owner accepts the result, even when the implementation PR is merged. These are existing GitHub issues, not generated phase tasks. Do not create new issues for this table.

| Issue | What remains |
| --- | --- |
| [#2012](https://github.com/DanAakesen/jarvis/issues/2012), [#1967](https://github.com/DanAakesen/jarvis/issues/1967) — daily core and tools | Verify Today’s resting target, active kcal and deficit against the shared budget. Full Chat/Voice parity still needs device checks. |
| [#1988](https://github.com/DanAakesen/jarvis/issues/1988) — GPT-Live sounds and behaves like Jarvis | Whole spoken turn, relay and state fixes merged. Physical and provider acceptance open. |
| [#2011](https://github.com/DanAakesen/jarvis/issues/2011) — proactive companion | Queue, observability and feedback merged. First enabled GitHub-triggered review verified. Delivery of an actual suggestion remains open. |
| [#2005](https://github.com/DanAakesen/jarvis/issues/2005) — Notes titles | Rename an existing note, then verify the saved title in Notes, Pinned, the reader and links. Editing an existing title is **not accepted on device**. |
| [#2010](https://github.com/DanAakesen/jarvis/issues/2010) — truthful Chat status | Returning during a reply passed on build 125. Check failed, cancelled and superseded states in the separate reply test. |
| [#2026](https://github.com/DanAakesen/jarvis/issues/2026) — iPhone Chat typing | Typing during a reply passed. Check rapid typing in a conversation with 100+ messages, focus, keyboard dismissal and draft retention. |
| [#2007](https://github.com/DanAakesen/jarvis/issues/2007), [#2008](https://github.com/DanAakesen/jarvis/issues/2008) — Proactive and Voice controls | Proactive settings and caption scrolling passed on build 125. The Voice activity label still needs a device retest. |
| [#2006](https://github.com/DanAakesen/jarvis/issues/2006) — Watch reliability | Composer tap targets passed on build 128. Dictation after Stop, call startup, audible replies and saved-turn recovery are **not accepted on device**. |
| [#1971](https://github.com/DanAakesen/jarvis/issues/1971) — incremental refresh, search and delivery | Local repository reads need not wait for GitHub discovery. Chat counts streamed bytes incrementally. Gmail refreshes unread membership and reuses headers; Calendar pagination keeps the original query. Neither is cross-poll cursor sync. Track remaining source, search and web performance work in the issue. |
| [#2009](https://github.com/DanAakesen/jarvis/issues/2009) — Foundry administration | Ask “show my Foundry agents”, then read the serving version and its model. Verify a version change on a test agent when authorized. |
| [#1972](https://github.com/DanAakesen/jarvis/issues/1972), [#1973](https://github.com/DanAakesen/jarvis/issues/1973) — verified dead code | Open. No broad deletion until the replacement and relevant contracts are qualified. |

## Phase task tracking

Next available P15 task ID: `P15-213`. Check GitHub issues and Git history before assigning it.

Use the table for active numbered work. `Complete` means task delivery, not physical acceptance. Keep any remaining device checks in the backlog above; completed tasks are in GitHub and Git history.

| ID | Issue | Task | Acceptance criteria | Depends on | Status |
| --- | --- | --- | --- | --- | --- |

[Plan status](.github/workflows/plan-status.yml) reconciles only numbered rows. On a plan push or manual run it creates issues for new IDs and resolves `Depends on` by issue title against **all** GitHub issues, including closed ones. Never reuse an ID. Keep the Issue/Status columns and issue checklist links to [Development workflow](docs/agent-context.md#development-workflow), [Start a task](docs/agent-context.md#start-a-task) and [Finish a task](docs/agent-context.md#finish-a-task) intact.
