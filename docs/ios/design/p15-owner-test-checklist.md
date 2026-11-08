# Saved owner testing checklist

Updated 8 November 2026. Check only items actually exercised on the device.
Automated/native passes and a TestFlight upload are not owner acceptance.

## Short next session

Build 82 contains Notes/Ember and the earlier build-81 fixes. The tighter Chat
reply spacing and progress inside the transcript are being qualified with the Factory navigation fixes for replacement build 84;
build 83 was cancelled before upload. Do not expect these fixes in 82.

- [ ] **Notes:** swipe the title-only pinned carousel, open a recent note, browse
  folders, and use New folder at the bottom right. Create/edit a disposable note,
  save with Done, reopen it and confirm the edit. Switch Raw on/off and confirm the
  complete original Markdown/frontmatter remains. Check pin/unpin in the editor.
- [ ] **Background and chrome:** check Ember readability and scroll Notes, Health,
  Factory and Settings. The background should remain visible around header/footer
  controls, especially the Notes and Factory footers.
- [ ] **Chat:** send once from Home and once from Chat. Confirm one message, an
  immediately cleared composer, one progress indicator and a final reply. Type a
  next draft while waiting and confirm it survives. Check short bubbles fit their
  text, final tools collapse under Jarvis, and partial reply text can be selected.
- [ ] **Reply spacing, next build:** the timestamp, reply and Tool activity should
  read as one group. Working/Writing reply should scroll with the conversation,
  without a duplicate above the Now bar. Open/close tools and select text; keep
  separate messages clear.

- [ ] **Factory navigation, replacement build:** tap Task 23 from Notifications,
  including an expanded older update, and open P11-13 from the board. Confirm the
  task and history load. An issue-only card should open its GitHub issue. Do not
  press Recover while the quota/capacity blocker remains.

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

- **Copilot comparison — deferred by the owner.** The complete prompts, steps and
  scorecard are in [the saved comparison guide](../../runtime-comparison-owner-test.md).
  Current remains the default; live Copilot compatibility passed, owner quality
  comparison is pending. No need to repeat the full comparison now.
- **Factory end-to-end — blocked, not ready for recovery testing.** Azure returned
  QuotaExceeded before the 128 GiB worker activated. Subscription quota details are
  pending. Once provisioned and qualified, recover existing task 23 / issue 1634,
  verify its actual delivery PR/checks, then verify idle deallocation. Do not create
  another scaffold task by repeating Prepare.
- **Approval friction:** after Factory is ready, confirm a clear authorized coding
  instruction proceeds without a redundant yes and a plan-only request stays a
  proposal. Backend acceptance passed; owner end-to-end confirmation is pending.

Loading animations and the general widget appearance were already accepted.
Retain those decisions; the widget checks above cover the later requested changes.

For a failure keep the build, screen/runtime, exact action, approximate time and
screenshot. Leave unexercised items unchecked; report successful checks too so this
list can be shortened.
