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
| P15-213 · [Combined mobile release](https://github.com/DanAakesen/jarvis/pull/2094) | Factory, Usage, Status and Proactive layouts and the Health, Calendar, Home, Notes, Voice and theme fixes are in build 140, **not accepted on device**. |
| TestFlight | **140** is the latest [Apple-confirmed build](https://github.com/DanAakesen/jarvis/actions/runs/45771929167). **143** [passed signed archive checks and uploaded](https://github.com/DanAakesen/jarvis/actions/runs/45869994534), including the embedded Watch companion. Apple readback did not confirm internal availability for 143. |
| Production | [Latest Deploy](https://github.com/DanAakesen/jarvis/actions/runs/45868585204) reused infrastructure, the backend image, web and the legacy agent. PI provisioning and deterministic readiness passed; live conversation acceptance was skipped. |
| Background PI | GitHub remains available for lookups, but its activity does not trigger a review. Suggestion delivery is **not accepted on device**. |
| P15-214 · [Background instructions editor](https://github.com/DanAakesen/jarvis/pull/2099) | Backend deployed; the iPhone editor is in build 143 and **not accepted on device**. |
| P15-215 · [Native CarPlay dashboard and Voice](https://github.com/DanAakesen/jarvis/pull/2104) | Build 143 verified the CarPlay entitlement in both the signed app and its profile. The dashboard and call are **not accepted on device**. |

### Next steps and blockers

Use [TestFlight build 140](https://github.com/DanAakesen/jarvis/actions/runs/45771929167) for the following device checks.

1. **Daily core, Chat and Voice:** Check project status and the approved issue-to-worker flow; save, find and rename a note, then check its iPhone folder without refreshing; create a task, verify its reminder, then complete it; read workouts and lifts in Danish and English. When logging food, save one meal and count it once. Compare Nutrition Today with Chat and Voice: logged and remaining kcal, resting target, active kcal, deficit and protein still needed. Track parity in [#2012](https://github.com/DanAakesen/jarvis/issues/2012).
2. **Voice and Watch:** On iPhone, check Thinking during a lookup after a spoken acknowledgement. Compare speakerphone, receiver and headset volume. Check caption scroll, centre swipes, expansion, scroll edges and a full-day chart in a window. On Watch, dictate short and long drafts; each Stop inserts text once. Check startup, route recovery, two complete audible replies, interruption of a third and the saved turn.
3. **Maps:** Ask for a named store nearby; expect a matching local business or an explicit no-match result. For a business with no nearby match, ask for the nearest and check a match and Directions beyond 10 km. A completed lookup should still report its result if reply writing fails. Compare the spoken departure estimate with the map card for an addressed event and a ten-minute buffer.
4. **Proactive:** Verify an ordinary Inbox follow-up against its linked card and check device delivery separately. See [Inbox acceptance](docs/inbox-loop/acceptance.md) for event-covered slots. **Show me fewer like this** is an approved follow-up, not part of build 140.
5. **iPhone layouts and follow-ups:** Check Factory search, the Usage period and drill-down, grouped Status evidence, and save, conflict and Retry for the Proactive settings in this build. Check Body trend periods against a new Apple Health reading, the separate Training walk count, gym log sheets, the Calendar create card, Week dividers and footer, Home Up Next and quick add, and Notes tiles, list continuation and a folder move with a table edit.
6. **Appearance and Watch Home:** Check the corrected red accent in light and dark, the remaining orb themes, plus-menu icon colour, finish and glow save/reset, and per-card colours. Reconnect Watch, check its palette and tinted complications, and scroll Home both ways to check the heading next to the clock.

Once Apple confirms build 143 or later, check that **Background instructions** survives reopening independently of personal guidance. On a head unit, check Schedule, Notes and Tasks, audible Voice, Mute, End and reconnection.

**Unverified in Foundry:** a usable `_meta` call ID for replay and the live provider rate-limit cause.

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
| [#2011](https://github.com/DanAakesen/jarvis/issues/2011) — proactive companion | Verify a suggestion from an eligible review, its linked evidence and delivery to the device. |
| [#2005](https://github.com/DanAakesen/jarvis/issues/2005) — Notes titles | Rename an existing note, then verify the saved title in Notes, Pinned, the reader and links. Editing an existing title is **not accepted on device**. |
| [#2010](https://github.com/DanAakesen/jarvis/issues/2010) — truthful Chat status | Check failed, cancelled and superseded states in **Test a reply**. |
| [#2026](https://github.com/DanAakesen/jarvis/issues/2026) — iPhone Chat typing | Check rapid typing in a conversation with 100+ messages, focus, keyboard dismissal and draft retention. |
| [#2007](https://github.com/DanAakesen/jarvis/issues/2007), [#2008](https://github.com/DanAakesen/jarvis/issues/2008) — Proactive and Voice controls | Verify the new inline Proactive flow and iPhone Voice activity, controls and scrolling. Both remain open for device acceptance. |
| [#2006](https://github.com/DanAakesen/jarvis/issues/2006) — Watch reliability | Dictation after Stop, call startup, audible replies and saved-turn recovery are **not accepted on device**. |
| [#1971](https://github.com/DanAakesen/jarvis/issues/1971) — incremental refresh, search and delivery | Local repository reads need not wait for GitHub discovery. Chat counts streamed bytes incrementally. Gmail refreshes unread membership and reuses headers; Calendar pagination keeps the original query. Neither is cross-poll cursor sync. Track remaining source, search and web performance work in the issue. |
| [#2009](https://github.com/DanAakesen/jarvis/issues/2009) — Foundry administration | Ask “show my Foundry agents”, then read the serving version and its model. Verify a version change on a test agent when authorized. |
| [#1972](https://github.com/DanAakesen/jarvis/issues/1972), [#1973](https://github.com/DanAakesen/jarvis/issues/1973) — verified dead code | Open. No broad deletion until the replacement and relevant contracts are qualified. |

## Phase task tracking

Check open PRs, GitHub issues and Git history before assigning the next unused P15 task ID.

Use the table for active numbered work. `Complete` means task delivery, not physical acceptance. Keep any remaining device checks in the backlog above; completed tasks are in GitHub and Git history.

| ID | Issue | Task | Acceptance criteria | Depends on | Status |
| --- | --- | --- | --- | --- | --- |

[Plan status](.github/workflows/plan-status.yml) reconciles only numbered rows. On a plan push or manual run it creates issues for new IDs and resolves `Depends on` by issue title against **all** GitHub issues, including closed ones. Never reuse an ID. Keep the Issue/Status columns and issue checklist links to [Development workflow](docs/agent-context.md#development-workflow), [Start a task](docs/agent-context.md#start-a-task) and [Finish a task](docs/agent-context.md#finish-a-task) intact.
