# Build 84 delivery record (candidate)

Updated 8 November 2026. Device acceptance remains separate from automated checks.

## Changes

- Timestamp, Jarvis reply and Tool activity use compact spacing. Existing paragraph
  spacing, tool touch targets and separation between messages remain.
- The single Thinking/Working/Writing reply/reconnecting status belongs to the
  scrolling conversation. The composer and Now bar contain no turn-progress row.
- The backend shows PC bridge warnings only while offline. Online and control-pause
  changes stay quiet, recovery clears the warning, and a later outage reopens it.
  Legacy online feed entries are hidden without deleting activity history.
- The owner reports a good quick Copilot smoke test. The implementation
  comparison and proposed controlled project test are saved; the tool/write comparison is pending. The consolidated
  [device checklist](p15-owner-test-checklist.md) retains the other outstanding checks.

## Earlier chat/bridge source and verification

PR [#1645](https://github.com/DanAakesen/jarvis/pull/1645) merged as
`1008ea6758f6fb66d05942c6717cbf736f5ebbda`, with complete tree identity to qualified
head `b7a0c8e6908a0f643ccffcafde1b8b6ef27d4110`.

- [CI 42476277900](https://github.com/DanAakesen/jarvis/actions/runs/42476277900)
  passed, including 7,416 backend tests (one skipped), 273 real SQL Server tests,
  backend build/smoke, web and JarvisCore checks. The runner image job passed on
  retry after a GitHub CLI download connection failure; no test was weakened.
- CodeQL passed on the qualified head. Local bridge/feed tests (11 passed) and
  scoped ESLint also passed.
- [Native 42475396547](https://github.com/DanAakesen/jarvis/actions/runs/42475396547)
  passed both existing presentation/turn-feedback cases, with no skipped tests.
  The status must be a descendant of the conversation ScrollView. Existing
  composer clearing, single short message, next-draft preservation, final tool
  collapse and native selection checks remain. Actual captures were reviewed.
  The tested iOS tree `ee8a42c08c2355ba399576e38be755b567845173` is identical in
  the final source and merge. The validation-only workflow was not merged.
- Native artifact `13616050030`, `chat-reply-spacing-evidence-1`, ZIP SHA256:
  `231c4c2f4895a20421593c91823c7b7121756c0dcc3abbf61f98444685fa88f1`.

## Delivery

Backend deployment 42477261659 passed readiness and live conversation acceptance.
TestFlight 42477928796 (83) was cancelled during archive, before upload, to bundle
the subsequent notification/task-detail reports. Replacement build 84 is pending
fresh qualification. Do not infer Apple processing or physical-device acceptance.

## Separate outstanding work

Notes/Ember were already uploaded in build 82 and remain included. Owner visual,
editing, dictation and reconnect checks remain in the consolidated checklist.
Copilot's live policy canary passed; the owner reports a good quick smoke test,
and the full comparison remains pending.
The 128 GiB worker is still unprovisioned because Azure returned QuotaExceeded.
Factory task 23 remains saved and must be recovered, not recreated, after capacity
and idle-deallocation verification. This release does not resolve that quota.

## Added Factory navigation correction

Task notifications use the typed task link, including older grouped updates and
running rows. Dismissal remains a separate action. Close the sheet before root
navigation opens the matching Factory detail. Cards without a linked task open
their existing HTTPS GitHub issue; no task is invented or started.

The iOS history model required taskId, but the backend returns TaskEventRecord
without that field. Live messages add it as TaskEventMessage. Accept its absence
in task-scoped history while continuing to reject missing/foreign IDs on live
streams. Correct the fixtures to match the actual contract. CI 42479297200 and
all 518 Core tests passed on 0dcf5a3. Native 42479307931 passed eight cases,
including board links/history, Chat and light/dark page chrome, but both notification
cases failed to reach task buttons. Retained captures show the links rendered;
the swipe group now explicitly contains its child accessibility controls rather
than coalescing them. Notification requalification is pending; no failed check is
reported as passing. Header/footer device feedback remains open: these captures
show continuous Ember around controls, but do not establish the owner's expected
scroll-behind behavior.


## Clarified chrome behavior included in this candidate

The owner confirmed both rectangular backing and missing scroll-behind content.
Replace the clipped shared header/footer stacks with transparent safe-area insets
and hide Chat's remaining bottom scroll-edge effect. Keep the first/last rows
reachable and retain individual glass controls. Native underlap geometry, actual
scrolling captures, Chat and notification navigation require fresh qualification.
The earlier open ambiguity is resolved; implementation is not yet native-accepted.


Native 42482352002 passed all 12 cases on source 82171fce (iOS tree
`d35348b9153e876cbfc56c9f28e8cb9281e60f40`). Artifact 13619290700 has ZIP SHA256
`18d928817db827d37e70a3a927ea6950154c7234c900a80a4910374860ae205e`.
Actual scrolled captures exposed title/text collisions despite the geometry pass.
A native soft top scroll-edge treatment is being qualified; bottom edges remain
unbacked. No release is accepted from the pre-refinement captures alone.

The refined header uses the iOS 26 safeAreaBar API to extend its soft native edge
through custom header content; simply changing the style on safeAreaInset is not
the documented custom-bar integration. The bottom keeps its transparent inset.


## Latest qualification and additional owner reports

Native 42485644758 on e02a3176 / iOS tree c9894fe714af17480a57f38f93696cb7bdb9bf7b
finished with five passing and two failing cases, no skips. PageChrome's four
light/dark tests and the Notes editor case passed. NavigationReliability timed out;
the older notification case did not reach the task-history assertion. These
failures block release. Artifact 13619149415 SHA256:
`fb236fa1000b2936528010bab4d4891686d1f2f575ec1f4deadb7b0a805d35bd`.
Reviewed dark Factory/Notes scrolling captures show the soft title treatment and
footer underlap; full visual/recovery acceptance remains incomplete.

The owner also reported Current test-chat ending after a partial acknowledgment,
which disappeared on history refresh. Long-running execution/progress and lift
edit/delete row actions are now captured in PLAN.md. Neither is implemented yet.

That implementation status describes the earlier failed candidate; the expanded
bundle below supersedes it.

## Expanded bundle candidate — 8 November 2026

Adds actual runtime-test progress/acknowledgment/tools, preserves unsaved partial
replies on history refresh and reattaches by original turn ID. Reconnect budget
starts on connection loss, not send time. Adds tap-to-edit and two-stage icon
swipes on Last lifts and history, updating/deleting the same SQL or vault record.
Older notification expansion now separates its heading touch target from child
task links after the native capture showed overlapping accessibility frames.
Local backend mutation checks pass (68), lint/build pass; native qualification of
this expanded candidate remains pending. No TestFlight upload has happened.

The first expanded native run (42491318279) stopped at compilation because the
new lift Core model referenced app-only JSON helpers. The corrected candidate
5122d147 decodes the enum directly. Its Core CI job passed; native run
42491913466 is qualifying app interactions. Backend PR #1647 deployed its images
and passed readiness/chat acceptance, but the full Deploy 42490995273 acceptance
job initially failed on `research_runner_transport`; the read-only retry passed.
Backend deployment is qualified; a live turn beyond the former cutoff is still
unverified. No iOS upload has occurred.

Reviewing the retained earlier navigation stackshot identified eager Core Image /
Metal setup in the unused Chat camera placeholder on the main thread. The image
context is now initialized lazily on the serial camera frame queue. Requalify
navigation and camera-sheet controls without increasing per-test time limits.

Native 42491913466 on 5122d147 passed ten of twelve tests: runtime-test progress,
both Notes themes, all three notification/Factory cases and all four chrome cases.
The initial Chat hit test and lift readback assertion failed. Artifact 13622955274
SHA256 `6998c7b031a4ab95a5463bdd8e7ff367dcf19ac1c8e2f782cd1449145bc5f7b9`.
The retained lift editor capture shows the test inserted `82.5` before the existing
`80` (result `82.580`), and the recording shows disabled fields during Save. Correct
the physical input coordinate, assert the edited value before saving, wait for the
sheet title to disappear, then assert the refreshed value and reopen it. Keep all
save/swipe/delete assertions. This is a test correction, not a claimed persistence
fix. Camera/navigation refinement is qualifying separately on unchanged limits.

## Active reply timer added to the bundle

Owner requested the Codex active-turn pattern and tap-only message timestamps.
Implemented locally with public commentary events, an elapsed header and thinking/
tools underneath, in normal and runtime-test chat. Fresh validation is pending.
Native 42492967707 passed 12/13: camera, runtime progress, navigation, both Notes
themes, all notification cases and four chrome cases. Lift-only 42494078211 still
failed readback: retained AX showed 83 kg for saved 82.5 kg. The Last lifts formatter
now preserves decimals; keep the save/reopen and two-stage gesture checks.
No TestFlight upload has happened for this candidate.

Candidate 6c80ca48 passed 524/525 Core checks; the sole failure was the historical
source guard requiring an orb in Chat. The selected Codex-style design replaces
that orb with the elapsed header and text/tool status. The guard now explicitly
requires the new header/status and forbids an extra Chat orb; all remaining shared
orb/canvas checks are retained. Native interaction assertions are unchanged.

Native 42496126403 on 6c80ca48 passed 4/6 tests. The elapsed header, continued
public progress, steering, runtime-test isolation and transparent navigation
passed. Long-press Copy and first-detent Edit hit testing failed. Artifact
13623871877 SHA256
`859818b5a1bd58586baf84dd201143c96d262e0a3d4cc2632341ce73f3c950d2`.
Actual captures were inspected: the timestamp appeared after long press without
selection, and the pencil was visible but not hittable. Native precedence and
overlay corrections require fresh evidence; no TestFlight upload is claimed.
The bundle also adds missing gym assistant tools using shared app persistence.
