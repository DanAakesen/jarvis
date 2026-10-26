# Health estimate list verification (#1321)

Chromium inspected the actual `ReviewSummary`, `ToolCallChip` and
`AttentionPopover` components with clearly labelled synthetic data at 390px/dark
and 1440px/light. Both list and approval screenshots were inspected. The fixture
uses existing application styles and the real invitation wrapper; it is not a
signed-in full-App or live-provider acceptance run.

Assertions in `fixtures/browser.py` require actual `ul > li` entries for protein,
calories, fat and unknown carbohydrates; Health branding for an old retained tool
name; no horizontal page overflow; no browser exceptions; and keyboard activation
of the synthetic approval callback. No backend food endpoint is called.

To reproduce from the repository root with installed dependencies, Python
Playwright and Chromium:

```sh
cp docs/ui/screenshots/1321/fixtures/qa1321.* apps/web/
npm run dev --workspace @jarvis/web -- --host 127.0.0.1 --port 5173
# In another shell:
python3 docs/ui/screenshots/1321/fixtures/browser.py
rm apps/web/qa1321.html apps/web/qa1321.tsx
```

The private Library screenshot could not be materialized: the supported helper
returned `library file transfer failed: download failed`, including one bounded
retry to a fresh explicit executor destination. Its pixels were not inspected in
this executor, and it is not included here. Diagnosis relies on the user report,
actual source paths and synthetic regression tests. Physical-phone, hosted model
and live speech behavior remain unverified.

## Checks

- Web: 119 tests across ReviewSummary, ConversationHistory, AttentionPopover and
  ToolCallChip passed. After rebasing onto main `1c1029a3`, those suites plus the
  stylesheet suite passed all 188 tests. Web TypeScript/Vite build and zero-warning
  lint passed. Backend/agent source blobs are unchanged by the rebase.
- Hosted agent: 291 model-client/tool tests passed; changed Python Ruff passed.
- Backend broad selection: 1,538 passed / 6 failed initially (four changed output
  expectations and two voice timing failures). Corrected expectations were rerun.
- Final food-presentation, food-review, Daily integration and full voice relay
  selection: 247 passed / one default-off catalogue timing failure; the unchanged
  failing test passed in isolation without extending its timeout. Food, lookup,
  nutrition review and composition suites also passed in the focused rerun.
  The final list-deduplication unit test passed again after the code-fence guard.
- Backend TypeScript build and zero-warning lint passed. Final diff checks passed.

These are selected local checks, not a passing full aggregate or hosted CI.
Local Node 24.19.0/npm 11.9.0 differs from pinned CI Node 22/npm 10. SQL integration
was not run. Drafts skip aggregate qualification; the parent owns readiness and
camera/release integration. Draft #1322 is rebased onto plus-menu main `1c1029a3`;
its native popover blur, menu order and Voice waveform remain unchanged.

The configured dependency feed returned HTTP 403 for pkce-challenge 5.0.1 and
hono 4.13.13. Restoring identical locked versions through registry.npmjs.org with
lock integrity checks succeeded. The committed lockfile is byte-identical to the
original; no dependency versions or registry configuration changed.
