# Capture to the inbox from an iPhone or Apple Watch Shortcut

Status: **unverified on a device.** The endpoint is tested in CI with a fake vault; the Shortcut steps below follow Apple's documented actions but have not been run on a phone or watch yet. Needs `JARVIS_INBOX_ENABLED=true` on the backend.

## What you get

Say or type a thought, tap the Shortcut, and it becomes a note in the vault's `Inbox/` folder. Jarvis keeps your words verbatim, structures the note (one note per thought), and follows up later. The Shortcut holds a **write-only capture credential**: it can add inbox items and nothing else, so a lost phone cannot read your inbox, notes or anything else.

## 1. Get a capture credential

In Jarvis chat on a device you trust, say: "Make me an inbox capture credential called iPhone Shortcut." Jarvis uses `inbox_capture_credential` and shows a value starting `ji.` **once**. Copy it into the Shortcut now; it cannot be shown again. Up to five credentials can exist.

- "List my capture credentials" shows labels and when each was last used.
- "Revoke the iPhone Shortcut credential" stops it immediately.

The same operations exist as owner-authenticated `POST`, `GET` and `DELETE /inbox/credentials`.

## 2. Build the Shortcut

In the Shortcuts app create a shortcut named **Inbox** with these actions in order:

1. **Dictate Text** (or **Ask for Input**, type Text). Language: your usual one; Danish and English both work.
2. **Format Date**: current date, custom format `yyyyMMddHHmmssSSS`.
3. **Get Random Number** between 100000 and 999999.
4. **Text**: the formatted date, a hyphen, then the random number. This is the capture key; a retry with the same key never saves twice.
5. **Get Contents of URL**
   - URL: `https://<your Jarvis backend host>/inbox/capture` (the same host the Jarvis app uses)
   - Method: `POST`
   - Headers: `Authorization` = `Bearer ji.…` (your credential), `Content-Type` = `application/json`
   - Request Body: **JSON** with `captureId` = the Text from step 4, `text` = the dictated text, `source` = `shortcut`
6. **Get Dictionary Value** for `confirmation` from the result, then **Show Notification** with it. If the call fails the notification must not claim success: add an **If** on the result containing `error` and show "Not saved, try again".

Limits: up to 4000 characters of text; at most 60 captures a minute. Any message containing a password, key or token is refused.

## 3. Run it

- **iPhone:** add to the Home Screen, the Action Button, a Back Tap, or "Hey Siri, Inbox".
- **Apple Watch:** Shortcuts that use Dictate Text run on the Watch. Open the shortcut from the Shortcuts app on the watch, or add it as a complication to a watch face.

A new run makes a new capture key. If a run shows "Not saved" the item may still have landed (the outcome is unknown); check the inbox before dictating it again, because a second dictation counts as a new thought. The weekly review (a later step) merges accidental duplicates.

## Not built

A native "Add to inbox" action inside the Jarvis Watch app (through the iPhone companion, with `POST /inbox/capture` and the owner's own sign-in). It needs Swift changes to the Watch, bridge and contract code that cannot be compiled or tested from the Linux build environment, so it is a separate follow-up.
