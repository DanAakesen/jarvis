# Local smoke settings correction (#1350)

Local review only. This correction is separate from diagnostic PR #1353 and has
not been pushed or published. It does not change saved settings or the runtime
default. The private reference screenshot is not copied into the repository.

## Confirmed drift

Normal hosted chat resolves reasoning from the session's `ModelSettings` (or the
existing environment setting when no session settings exist). Smoke resolves the
same model but then replaces the effort with none. Its additional 256-token cap
also changes the model's available reasoning/answer budget. The observed required
smoke rejection therefore does not establish failure of ordinary chat at a
different configured effort. A closed UI selection is not a database readback.

## Local correction

Use the same reasoning selection and configured output-token budget for smoke
and normal chat. Keep the same request fields; do not remove reasoning, substitute
an effort, change a saved value or add a retry. Record the effective effort beside
the existing effective-model span attribute; the effort observation is a fixed
enum or unsupported/unspecified marker, never arbitrary configuration text.
Invalid backend effort metadata retains its existing settings-invalid failure
before any provider request. This enum check does not establish live per-model
availability; provider rejections still remain failures.

The read-only smoke catalogue, source verification, no-op approval guard,
two-round bound, acceptance assertions and existing deadlines are retained.
Using the normal configured token budget may increase smoke inference cost over
the former cap; no live call ran and no spending result is claimed. A future
truncation/timeout remains evidence to report, not permission to choose new limits.

Research already resolves the research role and forwards its model and effort to
the separate Codex subscription-backed runner. The local regression includes
Terra/xhigh and verifies unchanged forwarding. Vision already forwards the vision
role's high effort to its provider. Neither path needs a setting rewrite to align
with the corresponding role. The actual server's role values still need readback;
tests must report a mismatch with the owner's expected values instead of silently
substituting them.

## Validation

Local model-client regression: 189 passed plus scoped Ruff. Full hosted suite:
1,025 passed, plus full hosted Ruff and byte compilation. Research/vision: 56
passed plus backend lint. The new cases compare
normal and smoke requests for none/low/medium/high/xhigh, record effective model
and effort, use the same configured 4096-token test budget and prove invalid
metadata produces no inference request. These are synthetic results, not live
acceptance. The correction remains local and separate from #1353.
