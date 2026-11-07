# Build 80 qualification and release — 7 November 2026

PR [#1631](https://github.com/DanAakesen/jarvis/pull/1631) merged as
`294a7929b8a21ef89fa36a8f0b1152461b0c9530`. Its full tree
`eefc7ccc2bed58a0e6f09748df09a66a92754f6c` exactly matches qualified PR head
`3857d0ff49ef017c02a04c22bbd0505b23e3becd`; iOS tree is
`d1bdee7aedeae358b9b2539e8490e33d0bd3d74a`.

Build **80 uploaded successfully at 17:06:13 UTC / 18:06:13 Copenhagen on 7 November 2026**
in unchanged TestFlight workflow [42394179996](https://github.com/DanAakesen/jarvis/actions/runs/42394179996),
from main `294a7929b8a21ef89fa36a8f0b1152461b0c9530` (PR #1631). Apple processing
and physical-device availability are not independently confirmed.

## Behavior and verification

The shared native composer clears sent text without replacing the focused editor,
handles keyboard Send, and preserves a later draft. Chat has one active progress
row and collapses completed tools under the final reply. Shared page headers and
Notes/Factory footer containers show the ambient background. Task titles allow two
lines and show only scope and priority; provenance remains in task details.

CI [42392412036](https://github.com/DanAakesen/jarvis/actions/runs/42392412036) and
CodeQL [42392412015](https://github.com/DanAakesen/jarvis/actions/runs/42392412015)
passed. Independent review approved the exact head. The app tree is
`dcf8417655ae26148ec25113035a13b15cb11c65` in both native verification sources:

| Native run | Qualified cases | Artifact SHA256 |
| --- | --- | --- |
| [42390300501](https://github.com/DanAakesen/jarvis/actions/runs/42390300501) | Six passed: Home handoff, runtime isolation, primary pages light/dark and Factory light/dark. The seventh Chat case failed an empty accessibility-value predicate and is not counted as passed here. | `db62f810da9a91aa88bf50490ab6b811cf068408d124a2f2278aba3112557513` |
| [42392408582](https://github.com/DanAakesen/jarvis/actions/runs/42392408582) | The corrected Chat case passed: button and keyboard Send, empty focused editor, one compact follow-up, one progress row, exact later draft and final collapsed tools. | `93056bbcba65dc3abe310dadf84a901ed0474ff6a8b0f6578622745b1de2f487` |

Only the Chat test and docs changed between those runs. The six passing test
sources and all application sources are identical. All 22 page captures and the
Chat boundary captures were inspected. The two actual empty-state attachments
report an existing, hittable editor with an empty string. The earlier recording
also shows empty text at the failed assertion; the assertion now re-resolves the
visible native editor and handles nil/empty UIKit values without accepting a
missing element. No production code changed to make that assertion pass.

Automatic duplicate Simulator runs 42392412047 and 42393878123 were cancelled
before boot, with final merged-tree identity checked before the latter cancellation.
Earlier failures remain in [the owner feedback record](p15-build79-feedback.md).
The validation-only workflow branch is not merged.

## Deployment and owner checks

Backend scaffold recovery shipped separately in PR #1632 / main `ce652a06`.
Deploy [42389927724](https://github.com/DanAakesen/jarvis/actions/runs/42389927724)
passed readiness and required live acceptance. The owner was told to retry
“Prepare the widget in Jarvis”, inspect the proposal and approve once. That actual
owner scaffold write is still unconfirmed. No iOS update is needed for this fix.
Normal post-merge Deploy
[42393878132](https://github.com/DanAakesen/jarvis/actions/runs/42393878132)
passed readiness and required live acceptance at 17:00:06 UTC (14 ok, expected
nonblocking PC bridge down), reusing unchanged applied backend/agent/web versions.
TestFlight workflow 42394179996 successfully uploaded build 80 from main 294a7929.

On build 80, check the reported header/footer states while scrolling, send a
message by button and keyboard, type a new draft during the reply, and inspect
long task titles with scope/priority only. Captures cover English, normal text size
and synthetic data. Their shifted status-bar pixels do not establish physical-device
safe-area or status-bar correctness. System-keyboard dictation still needs device
acceptance. Copilot remains disabled; no compatibility receipt is issued here.

The Notes carousel/folder/editor image is a separate selected visual refinement,
recorded in DESIGN.md. It is not implemented in this build.
