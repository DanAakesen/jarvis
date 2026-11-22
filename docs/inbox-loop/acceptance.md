# Loose Ends: switch-on and acceptance

Status: **all eight steps are built, merged and dark.** Nothing below has run against a live vault, a real model or a device. Switching on is the owner's decision and deployment; this page is the checklist.

**Update 21 November 2026 (#1969):** the follow-up nudges, the daily missed-capture audit and the weekly review ran only from the 07:00 and 18:00 proactive slot engine, which is deleted. `inboxNudgesEnabled` therefore does nothing until the owner decides what triggers them again (decision A in `docs/pi/cutover.md`). Capture, the tools, the credential routes, the MCP server and `/inbox/status` are not affected.

## What each switch turns on

| Switch | Where | Turns on |
| --- | --- | --- |
| `inboxEnabled` | `infra/main.bicep` parameter (sets `JARVIS_INBOX_ENABLED=true`) | Chat and voice tools (`inbox_capture`, `inbox_items`, `inbox_close`, `inbox_capture_credential`, `inbox_nudge_style`), `POST /inbox/capture`, the credential routes, `/inbox/mcp`, `/inbox/status` |
| `inboxNudgesEnabled` | same (sets `JARVIS_INBOX_NUDGES_ENABLED=true`) | Nothing at present. It armed the slot review and nudge, the daily missed-capture audit (18:00 run) and the weekly deep review and nudge-style rewrite (first Sunday run) inside the proactive runs; those runs and their hook were removed (#1969). `/inbox/status` still reports the flag |

Both default to `false`. `inboxNudgesEnabled` has no effect until the nudges have a trigger again; they would then also need `JARVIS_PROACTIVE_ENABLED=true` (already on in production) and the Notes source enabled in Proactive settings, and the proactive pause switch would stop them.

## What is left for the owner

1. **Switch-on:** set `inboxEnabled` to `true` in `infra/main.parameters.json` and deploy (`inboxNudgesEnabled` does nothing until the nudges have a trigger again). Deploy applies migrations `0081` to `0085` (additive; each has a tested down script; `0080` is the proactive-events queue, already merged).
2. **Vault convention:** review and merge DanAakesen/vault#1 (the `Inbox/` convention in the vault `AGENTS.md`, plus a corrected sync paragraph). The backend does not depend on it; it lets other agents capture without Jarvis.
3. **ChatGPT and claude.ai connectors:** create an Entra app registration with `inbox.read` and `inbox.write` scopes, like the Health connector. Not done and not buildable without it; until then the MCP server works for clients that send a bearer header (Claude Code, Codex, Copilot CLI).
4. **Device acceptance** of the checklist below: nothing has run against the live vault, a real model or a device.

The GitHub App already has Contents write on the private vault (it writes notes and tasks today).

## Acceptance checklist (owner, on a real device)

Switch on `inboxEnabled` and test. `inboxNudgesEnabled` has no effect for now, so the two nudge items below (marked blocked) cannot be tested yet.

- [ ] Say an idea in chat ("we should do a padel night before Christmas"). A note appears in `Inbox/` within seconds and in Obsidian within about ten minutes; your words are quoted verbatim.
- [ ] Say the same by voice. Ask "what is in my inbox?" and see it listed.
- [ ] Say "bin it". The note moves to `Inbox/Closed/` with a trail line.
- [ ] Ask Jarvis for an inbox credential, build the Shortcut (`docs/inbox-loop/shortcut.md`), run it from the iPhone and the Watch. Revoke the credential and see the Shortcut fail.
- [ ] Connect one assistant over MCP (`docs/inbox-loop/mcp.md`) and capture from it.
- [ ] Open `GET /inbox/status` (owner token): live items, nudges, spend today and over 30 days by kind.
- [ ] Blocked until the nudges have a trigger: with nudges on, wait for 07:00 or 18:00 (or use the manual proactive check). A nudge arrives as a card and, for medium or high, as one push. Give it a thumb on the card; after the next run the note's trail shows it and `/inbox/status` counts it.
- [ ] Blocked until the nudges have a trigger: after a day, check `lastAuditDay`; after a Sunday, `lastWeeklyReviewDay` and "what is my nudge style?" in chat.
- [ ] Watch the spend for a week. The design estimated about 5 to 17 DKK a month inside the 100 DKK budget, with a 1 DKK a day inbox ceiling.

## Cost

The estimates in `design.md` section 8 are **not yet replaced by measured values**: nothing has run. Every call is now recorded per day and kind (`review`, `audit`, `weekly`, `triage`) in `dbo.inbox_spend` and in the shared proactive ledger, and `/inbox/status` shows it. After a week of use, replace the table in section 8 with the measured figures. Costs are estimates from list prices, not invoices.

Rails already in place: the monthly budget gate before every run, the audit and weekly review stop at the 80% warning, a 1 DKK a day inbox ceiling read from the persisted ledger (so it holds across replicas), at most one nudge per run, and no model call when nothing can be nudged.

## Known gaps

- Thumbs on the push notification itself (iOS and web notification actions) are not built; thumbs come from the proactive card's useful and wrong buttons.
- A native "Add to inbox" action in the Jarvis Watch app is not built; the Shortcut runs on the watch.
- ChatGPT and claude.ai custom connectors need the Entra OAuth registration above (owner action).
- The inbox spend is also visible only in `/inbox/status`, not yet on the Proactive page.
- After an index rebuild, nudge clocks restart at the rebuild time.
- None of this has been run on a device or against the live vault.
