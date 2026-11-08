# Build 84 delivery record

Updated 8 November 2026. Device acceptance remains separate from automated checks.

## Latest verified state

PR #1646 merged as `4c60ba94a35c0eb81ec998cd5225bfb567ed305b`, with complete tree
identity to qualified head `737c6bcc1fc81b1f26e065b69641cbce6282a2f3`.
CI 42501191916 and CodeQL passed, including all 526 Core tests. Native 42500193416
passed all six changed interaction cases on 7d59f447 (identical app/Core source):
runtime isolation, real word selection, live progress, steering, staged lift edit/
save/reopen/delete and header navigation. Actual captures were inspected.
The selector-only follow-up 42501271718 passed on the final head with zero failures
or skips in 104.578 seconds, under unchanged test limits.

Retained native evidence: artifact 13625149636, SHA256
`83b3491aa38a3039f58b9c28cd2c1ef7614ae5bdf41061ed1010de13b4612d0e`;
final-selector artifact 13626545673, SHA256
`ff09cc651ff7c6ebf3cc695e2cccaaf4498e563c8f34c6323ebae062b1c57436`.
Unchanged Notes, notification and chrome cases passed in 42492967707; its old lift
failure was fixed and separately requalified above, not waived.

Deploy 42502357217 passed backend/agent deployment, readiness and live conversation
acceptance. TestFlight run 42503950006 uploaded build 84 from b6b515d9 and completed
successfully at 17:22 UTC on 8 November. Its app/Core source is unchanged from the
qualified app candidate. The owner has confirmed testing build 84 on device. Extra deployment 42503216228 also passed. Copilot's gym catalogue
refresh 42503779972 failed after version creation while reading the inventory;
read-only inspection 42505663536 failed without writes. PR #1651 corrected pagination
and exact-version reconciliation and merged after full CI passed on retry. Deploy
42507969183 passed normal acceptance. Read-only inspection 42509996653 then found
one matching version, and refresh 42510264543 passed the fresh managed two-turn
canary plus live acceptance at 18:34 UTC. Copilot is now ready for owner retesting;
full Current/Copilot quality comparison is still pending. Later entries below
preserve investigation history; this section is the current qualification state.

Factory quota is separate: #1649 merged as `b6b515d9` after full CI 42502476758.
Live quota run 42503224623 received HTTP 403 AuthorizationFailed during quota
inspection, before any quota write. The 128 GiB worker is not provisioned and Task 23
is not complete. See [the quota runbook](../../factory-worker-quota.md).


## New owner findings after the build

The owner confirmed that build 84 freezes when opening the Notes right sidebar;
the app does not close. The shared phrase/Overview is also missing. PR #1653
restores those components. Native run 42507483140 passed the page-order test but
failed the 1,003-note responsiveness test at the unchanged 120-second limit, and
both editor-entry cases. The actual device cause is not yet proven. Retained
screenshots/hierarchy show the restored header and the editor-test target below
the footer. The corrected candidate then passed native run 42510119801 (four tests, no failures/skips)
and all 530 Core tests. Actual captures were reviewed. The repair merged as #1653
and TestFlight 85 uploaded successfully in 42511641193; owner retesting is pending;
preserve the approved carousel, folder sheet and editor.

The owner separately confirmed that header/footer transparency now works well
across pages in build 84. Both previously reported chrome regressions are accepted.
Do not change shared header/footer behavior as part of the Notes repair.

Apple Watch implementation is in Jarvis2 secondary's draft PR #1652, still open
at head f903bf11 on 8 November.
Primary remains responsible for integration, qualification and release. That report
does not establish completed implementation or a Watch build.

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

The retained synthesized selection event pressed (196, 453.17), after the short
Product review line rather than on a word. The selection test now presses a word
in the first heading and also asserts that long press does not reveal the timestamp.
Copy and native selection remain required; this does not waive either behavior.

Gym parity follow-through: Home/Health had not wired the existing manual workout
read endpoint, and the backend's daily vault format differs from legacy app log
filenames. A read adapter now includes saved SQL sessions (including pending vault
copies) alongside legacy logs, before HealthKit de-duplication. Manual record IDs
remain distinct from HealthKit IDs. Historical app vault writes remain supported;
this change does not migrate or rewrite them. Core fixture coverage checks that
chat-logged sessions appear, retain identity/duration and respect the date range.

Candidate 04735515 passed all 526 Core tests and CodeQL. Backend CI passed 7,443
tests with two outdated expected tool catalogues; both lists now require
gym_lifts/gym_sessions and explicitly exclude gym tools when Health is disabled.
The focused catalogue, composition, gym, parity and instruction checks pass (64).
No runtime code or iOS source changes in that correction. After normal deployment,
refresh the existing Copilot definition with both authorized managed-chat inputs
and require its two-turn canary before claiming parity there.

Native 42498089381 passed selection and the two progress cases, but runtime launch
timed out and the lift swipe failed. Its recording shows the swipe opening the
editor on release. The shared row now uses a discrete tap gesture that fails
during dragging, with independent sibling action buttons. Qualification also
presses the revealed pencil, verifies the saved value and checks that revealing
actions never opens the editor or deletes a record. No limits are relaxed.

Native 42498873982 again passed actual-word selection, both progress cases and
header navigation. Runtime-test execution reached its input at the 120-second
limit after slow broad accessibility queries; lift reveal still opened the editor.
The runtime test now addresses the observed text views and menu button directly,
retaining every assertion and the same timeout. The lift correction is separate.
Final candidate 7d59f447 passed full CI 42500153035; native requalification remains
pending, with the updated runtime selector check included before release.
