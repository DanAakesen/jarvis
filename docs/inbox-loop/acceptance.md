# Loose Ends: switch-on and acceptance

Dan approved capture and automatic follow-ups. Production parameters enable both. Use the checks below to verify the deployed revision and device.

## What each switch turns on

| Switch | Where | Turns on |
| --- | --- | --- |
| `inboxEnabled` | `infra/main.bicep` parameter (sets `JARVIS_INBOX_ENABLED=true`) | Chat and voice tools (`inbox_capture`, `inbox_items`, `inbox_close`, `inbox_capture_credential`, `inbox_nudge_style`), `POST /inbox/capture`, the credential routes, `/inbox/mcp`, `/inbox/status` |
| `inboxNudgesEnabled` | same (sets `JARVIS_INBOX_NUDGES_ENABLED=true`) | Enables Inbox review in the PI slots and after a successful Check now, the daily missed-capture audit and the weekly nudge-style review. |

Production overrides both template defaults in `infra/main.parameters.json`. Reviews require Background PI, an enabled Notes source and available budget. An earlier event can satisfy the PI wake for a slot while its Inbox review still runs once.

## What is left for the owner

1. **Switch-on:** read the deployed revision and `GET /inbox/status`. Confirm both flags before testing.
2. **External assistants:** Use the [MCP contract](mcp.md). OAuth connectors are not built.
3. **Device acceptance:** Run the checklist after approved switch-on.

## Acceptance checklist (owner, on a real device)

Use one test idea and its normal 07:00 or 18:00 Copenhagen review. An item receives a nudge only when it warrants one.

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
