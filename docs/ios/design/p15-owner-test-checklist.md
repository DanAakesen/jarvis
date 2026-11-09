# Saved owner testing checklist

Updated 8 November 2026. Check only items actually exercised on the device.
Automated/native passes and a TestFlight upload are not owner acceptance.

## Short next session

Build 86 uploaded successfully in 42515467682 with the Home Today workout totals
correction. Once it appears in TestFlight, perform the Home check below. The owner
has already confirmed the Notes correction is fixed after build 85.

Build 84 uploaded successfully in 42503950006 on 8 November at 17:22 UTC. The owner confirmed using build 84 on device. It includes the Chat progress,
Factory navigation, transparent chrome, native selection and lift-editing fixes,
alongside Notes/Ember from 82. Build 83 was cancelled before upload.

**Notes correction accepted:** after build 85, the owner confirmed the Notes page
is fixed on 8 November. The sidebar freeze and missing phrase/Overview are closed.
Preserve the previously approved browsing/editor interactions; do not infer that
every additional optional Notes check below was separately exercised.

- [x] **Notes sidebar and phrase/Overview:** owner confirmed fixed after build 85.
- [ ] **Home Today workout totals:** new report shows two workouts but zero active
  time and kcal; longer periods and Health work. In build 86,
  compare Today against the same workouts in Health, then switch 7d → Today and
  refresh. Counts must not duplicate and recorded time/calories must remain.

- [ ] **Notes:** swipe the title-only pinned carousel, open a recent note, browse
  folders, and use New folder at the bottom right. Create/edit a disposable note,
  save with Done, reopen it and confirm the edit. Switch Raw on/off and confirm the
  complete original Markdown/frontmatter remains. Check pin/unpin in the editor.
- [x] **Header/footer transparency:** owner confirmed it works well across pages
  in build 84 on 8 November, including the previously reported backing/scroll-behind
  problems. Preserve this accepted behavior during the Notes correction.
- [ ] **Background readability:** any additional light/dark or accessibility spot
  checks remain optional; transparency acceptance does not imply all visual checks.
- [ ] **Chat:** send once from Home and once from Chat. Confirm one message, an
  immediately cleared composer, one progress indicator and a final reply. Type a
  next draft while waiting and confirm it survives. Check short bubbles fit their
  text, final tools collapse under Jarvis, and partial reply text can be selected.
- [ ] **Reply spacing, build 84:** the Working for timer should sit above public progress updates, with
  thinking/tool activity underneath. Tap a message to show its timestamp and tap
  again to hide it. Long-press selection must still work. All progress scrolls with the conversation,
  without a duplicate above the Now bar. Open/close tools and select text; keep
  separate messages clear.

- [ ] **Factory navigation, build 84:** tap Task 23 from Notifications,
  including an expanded older update, and open P11-13 from the board. Confirm the
  task and history load. An issue-only card should open its GitHub issue. Do not
  press Recover while the quota/capacity blocker remains.

- [ ] **Jarvis gym logging, Current backend deployed:** send one explicit lift/session
  request with exercise, kg, reps, sets, date and session. Verify the returned values
  in Health and the session in Home after refresh, including while a vault copy is
  pending. Ask Jarvis to correct that same test lift, then delete the test entry;
  verify no extra approval and no duplicate record. Copilot's tool-definition refresh and fresh live canary passed in 42510264543;
  the same owner logging/readback/edit/delete test is now ready in Copilot. The earlier failed workout is not replayed
  automatically. Historical app vault logs are retained without migration.

- [ ] **Lifts, build 84:** tap a disposable lift in Last lifts and confirm
  the editor contains its current exercise, weight, reps and sets. Change one
  value, save and reopen it. Short-swipe left to reveal only the pencil; swipe
  farther to reveal trash beside it. Swiping alone must not delete. Tap trash on
  the disposable lift and confirm it stays removed after refresh.

- [ ] **Long replies and test chat, build 84:** use a read-only request
  that requires several tools. Expect acknowledgment, actual tool activity and
  one progress row in the conversation until a final result. If the connection
  drops, use Refresh test history and verify the partial acknowledgment stays
  visible or the existing turn resumes. Do not resend an uncertain write. A live
  run past the former 210-second boundary still needs qualification.

- [ ] **PC bridge warning, backend deployed:** an online PC should not create
  a Now-bar notification. An offline warning should clear quietly on reconnect.

## Additional device checks when convenient

- [ ] **Dictation and keyboard Send:** each sends once and clears the editor;
  delayed dictation callbacks must not restore the sent text or erase a new draft.
- [ ] **Connection recovery:** during a read-only reply, briefly interrupt and
  restore connectivity. Check progress/recovery and no duplicate message. Inspect
  whether an action succeeded before retrying a write after any timeout.
- [ ] **Widgets:** Workouts, Factory and Tasks open their matching sections; Tasks
  does not show the old latest-note summary. Supporting light-mode text is readable.
- [ ] **Home:** section labels, left title/right periods, calendar/task icons and
  swipe-to-complete work and align correctly.
- [ ] **Health and settings:** Body trend is a graph; populated numeric settings
  retain visible labels. Check the workout summary spacing.
- [ ] **Task rows and notifications:** long task titles use two lines; scope and
  priority have no redundant Inbox/source label. No Away mode on iOS and no empty
  Background activity bar.

## Deferred or blocked

- **Apple Watch:** PR #1652 merged after primary review and native qualification. Build 87 failed signing because both Watch App IDs lack the shared App Group association. Wait for a successful replacement build before physical Watch tests.
- **Copilot comparison — parked by owner on 9 November after both combined exercises completed.** The saved [comparison guide](../../runtime-comparison-owner-test.md) records independently verified note creation/revision for both. Current's post-repair rerun now delivers its final reply. Both report an initial save refusal; refusal/routing diagnosis and matched speed/cost evidence remain open. Current stays default; no repeat is needed just to prove this case.
- **Factory end-to-end — ready for a fresh representative task.** The 128 GiB worker is provisioned and activated in 42530882044; disk, credentials, backend readiness and actual idle deallocation passed. Owner confirms existing tasks are tests and need no migration/recovery. Verify delivery PR/checks and subsequent idle shutdown on a fresh representative task; no test tasks have been deleted.
- **Approval friction:** after Factory is ready, confirm a clear authorized coding
  instruction proceeds without a redundant yes and a plan-only request stays a
  proposal. Backend acceptance passed; owner end-to-end confirmation is pending.
  The broader [productivity review](../../productivity-blocker-review.md) records
  remaining proposal expiry, interpretation failure and recovery problems; those
  follow-ups are not all implemented in this release.

Loading animations and the general widget appearance were already accepted.
Retain those decisions; the widget checks above cover the later requested changes.

For a failure keep the build, screen/runtime, exact action, approximate time and
screenshot. Leave unexercised items unchecked; report successful checks too so this
list can be shortened.
