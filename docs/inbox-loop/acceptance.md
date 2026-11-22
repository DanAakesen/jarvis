# Loose Ends: switch-on and acceptance

Status: **built, switched off by default.** Dan approved capture and automatic follow-ups. Both production flags were verified off on 22 November. Production activation, real vault/model use and device acceptance are unverified.

## What each switch turns on

| Switch | Where | Turns on |
| --- | --- | --- |
| `inboxEnabled` | `infra/main.bicep` parameter (sets `JARVIS_INBOX_ENABLED=true`) | Chat and voice tools (`inbox_capture`, `inbox_items`, `inbox_close`, `inbox_capture_credential`, `inbox_nudge_style`), `POST /inbox/capture`, the credential routes, `/inbox/mcp`, `/inbox/status` |
| `inboxNudgesEnabled` | same (sets `JARVIS_INBOX_NUDGES_ENABLED=true`) | Enables the old engine's post-findings hook for slot reviews, the daily missed-capture audit and the weekly nudge-style review. |

Both default to `false`. The nudge hook also needs `JARVIS_PROACTIVE_ENABLED=true` and an enabled Notes source. PI's brain owns the scheduled slots and Check now when PI is configured. Enabling flags alone does not make that brain call the old engine's hook; check the [remaining trigger decision](../pi/cutover.md#43-the-old-chat-harness-and-old-proactive-pipeline-backend) before enabling scheduled nudges.

## What is left for the owner

1. **Switch-on:** with the owner's approval, enable `inboxEnabled` and qualify capture before considering nudges. Resolve the scheduled trigger before enabling `inboxNudgesEnabled`. Migrations `0081` to `0085` define the inbox records; `0080` defines the proactive-events queue.
2. **External assistants:** Use the [MCP contract](mcp.md). OAuth connectors are not built.
3. **Device acceptance:** Run the checklist after approved switch-on.

## Acceptance checklist (owner, on a real device)

Test capture before nudges. Test the scheduled rows only once the trigger and nudge activation are confirmed.

- [ ] Say an idea in chat ("we should do a padel night before Christmas"). A note appears in `Inbox/` within seconds and in Obsidian within about ten minutes; your words are quoted verbatim.
- [ ] Say the same by voice. Ask "what is in my inbox?" and see it listed.
- [ ] Say "bin it". The note moves to `Inbox/Closed/` with a trail line.
- [ ] Ask Jarvis for an inbox credential, run the [Shortcut](shortcut.md) on iPhone and Watch, then verify the revoked credential no longer works.
- [ ] Connect one [MCP assistant](mcp.md) and capture from it.
- [ ] Open `GET /inbox/status` (owner token): live items, nudges, spend today and over 30 days by kind.
- [ ] With nudges on: wait for 07:00 or 18:00 (or use the manual proactive check). A nudge arrives as a card and, for medium or high, as one push. Give it a thumb on the card; after the next run the note's trail shows it and `/inbox/status` counts it.
- [ ] After a day, check `lastAuditDay`; after a Sunday, `lastWeeklyReviewDay` and "what is my nudge style?" in chat.
- [ ] Use the private status view to verify ledger entries by day and kind. Do not publish spend or owner limits.

## Known gaps

- Thumbs on the push notification itself (iOS and web notification actions) are not built; thumbs come from the proactive card's useful and wrong buttons.
- A native "Add to inbox" action in the Jarvis Watch app is not built; the Shortcut runs on the watch.
- ChatGPT and claude.ai custom connectors need the Entra OAuth registration above (owner action).
- The inbox spend is also visible only in `/inbox/status`, not yet on the Proactive page.
- After an index rebuild, nudge clocks restart at the rebuild time.
- None of this has been run on a device or against the live vault.
