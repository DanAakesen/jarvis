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
| TestFlight **145** | [Apple confirmed internal availability](https://github.com/DanAakesen/jarvis/actions/runs/46045418668). The [signed archive](https://github.com/DanAakesen/jarvis/actions/runs/46042793866) verified the CarPlay entitlement and embedded Watch companion. |
| P15-213 · [Combined mobile release](https://github.com/DanAakesen/jarvis/pull/2094) | Dan confirmed the Health, Home, Calendar, Notes editing, Factory, Usage, Status, inline Proactive and red-theme checks on build 143. Build 145 includes shorter Home card footers, pinned notes below Schedule, Obsidian table spacing, Watch voice recovery and simpler Proactive preferences. Device confirmation remains open for the table and Watch fixes. |
| Production | The [production deployment](https://github.com/DanAakesen/jarvis/actions/runs/46040812077) applied backend and PI changes from [#2118](https://github.com/DanAakesen/jarvis/pull/2118). Backend health and the scheduled Vault Mirror check passed. Live conversation acceptance was skipped. |
| Background PI | GitHub and weather provide context, not wake triggers. Vault notes and tasks supply review context. Live X search needs a provider credential and an explicit public search. Proactive push delivery still needs device confirmation. |
| P15-214 · [Background instructions editor](https://github.com/DanAakesen/jarvis/pull/2099) | Backend deployed; the iPhone editor is **not accepted on device**. |
| P15-215 · [Native CarPlay dashboard and Voice](https://github.com/DanAakesen/jarvis/pull/2104) | Signed and internally available, **not accepted on device**. |

### Next steps and blockers

Verify in production: no weather-only wakes, at most one automatic forecast reservation per owner per Copenhagen day, and reuse only for the same unchanged calendar trip.

The iPhone Notes live formatting awaits a device check. Open a note with a heading, highlight, checklist and table, edit a line, then tap Done and reopen it in Obsidian.

The iPhone sidebar swipe fix awaits a device check in the next build. Drag left from the right edge on Home and a scrolling page. In Voice, swipe across a result to page it, then open the sidebar from above the result.

Use the Apple-confirmed TestFlight build above for these device checks.

1. **Daily core, Chat and Voice:** Check project status and the approved issue-to-worker flow; save, find and rename a note, then check its iPhone folder without refreshing; create a task, verify its reminder, then complete it; read workouts and lifts in Danish and English. When logging food, save one meal and count it once. Compare Nutrition Today with Chat and Voice: logged and remaining kcal, resting target, active kcal, deficit and protein still needed. Track parity in [#2012](https://github.com/DanAakesen/jarvis/issues/2012).
2. **Voice and Watch:** Dan confirmed iPhone Thinking during a lookup. Compare speakerphone, receiver and headset volume. Check caption scroll, centre swipes, expansion, scroll edges and a full-day chart in a window. On Watch, dictate short and long drafts; each Stop inserts text once. On Watch, repeat a weather lookup with the phone locked and nearby, then check a second audible reply, interruption and saved history.
3. **Maps:** Ask for a named store nearby; expect a matching local business or an explicit no-match result. For a business with no nearby match, ask for the nearest and check a match and Directions beyond 10 km. A completed lookup should still report its result if reply writing fails. Compare the spoken departure estimate with the map card for an addressed event and a ten-minute buffer.
4. **Proactive:** Verify an ordinary Inbox follow-up against its linked card and check device delivery separately. See [Inbox acceptance](docs/inbox-loop/acceptance.md) for event-covered slots. **Show me fewer like this** is an approved follow-up, not in the current build.
5. **Notes:** Save an existing Jarvis table between two paragraphs. Open the same note in Obsidian and verify it shows a grid with the following paragraph outside it.
6. **Appearance and Watch Home:** Check the remaining orb themes, finish and glow save/reset, per-card colours, tinted complications and the heading when scrolling Watch Home. Dan confirmed true red in light and dark, the Watch colour after reconnecting and the composer plus-menu icons.

On a head unit, filter the schedule, expand a pinned note and complete a task. Start Voice, check that replies use car audio, mute and unmute, reconnect, then end the call and verify that the dashboard returns. On iPhone, edit proactive preferences, reopen the page and verify the saved text.

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
| [#2010](https://github.com/DanAakesen/jarvis/issues/2010) — truthful Chat status | In ordinary PI Chat, a working reply must not show Failed; check failure, cancellation and supersession separately. Verify **Test a reply** reports its selected runtime's outcome. Both are **not accepted on device**. |
| [#2111](https://github.com/DanAakesen/jarvis/issues/2111) — iPhone sidebar swipe | Reported broken. Verify right-edge swipes open the sidebar and left-edge Back still works on a pushed page. **Not accepted on device.** |
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
