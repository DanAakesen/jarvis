# Factory refresh and contextual loading evidence

These captures use labelled fixture tasks, not production task data.

| Viewport | Capture |
| --- | --- |
| Desktop, 1280 x 900, dark, reduced motion | [Desktop board](desktop.png) |
| Phone, 390 x 844, dark, reduced motion | [Phone board](phone.png) |

The board remains visible while its event stream reconnects. Initial loading
uses card placeholders. Conversation history and embedded task details use line
and panel placeholders rather than an additional orange core.

## Refresh checks

A Chromium fixture run at both viewport widths emitted a task event and delayed
the following task-list response by 1.8 seconds. During the pending request and
after completion, the board element was retained, its vertical position and
horizontal scroll moved by zero pixels, and the selected task remained selected.
No `.loader-core` appeared during the refresh. Subsequent fixture capture attempts
encountered intermittent navigation/selector timeouts; the screenshots above are
separate reduced-motion captures, not images of the pending-request measurements.

The signed-in local production-backed board was also inspected: 11 task cards,
no core loaders and no alert messages. No real Recover request was sent merely
to test presentation.

## Regression coverage

`TasksPage.test.tsx` holds an SSE-triggered refresh pending and checks board
identity, both scroll offsets, task selection and absence of a loading replacement.
A separate test clicks Recover, holds the ensuing refresh pending, verifies
the control request and checks that the board and scroll positions survive the
task's move to Running. Empty and failed refreshes are covered too.

`ConversationHistory.test.tsx` checks that initial history loading is a line
placeholder without a core. Its existing persisted-tool-outcomes assertion
remains unchanged; it has a known local en-DK failure because it expects
`2.5 voice minutes` while the locale renders `2,5 voice minutes`.
