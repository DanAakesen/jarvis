# Jarvis iOS: backend integration contract (draft)

Draft for the native iPhone app, derived from reading the current backend and web client on 29 October 2026. The code is the source of truth: open the cited file before relying on a detail. Items marked UNVERIFIED were not confirmed from code and need a test on a real device. Updated on the same day for two owner answers: a Face ID lock that is on by default, and approvals that are allowed from the Lock Screen. The build is not authorised yet, so nothing here is work in progress.

## 1. Sign-in and session

- Every HTTP and SSE request sends the header `Authorization: Bearer TOKEN`.
- An Entra token is accepted only when the audience is the API client ID, the issuer is v2, the scope is `access_as_user`, and `oid` and `tid` match the owner. Anyone else gets 403.
- Owner session (on in production since 23 October 2026): after Microsoft sign-in the app calls `POST /auth/session` with an optional `deviceLabel` and receives a one-time token shaped `js.ID.SECRET`. Send it as the Bearer token instead of the Entra token. Idle lifetime is 10 days, the absolute cap is 30 days, and at most 10 sessions are active. There is no refresh call: when it expires, sign in again. `DELETE /auth/session` revokes this device and `DELETE /auth/sessions` revokes all of them.
- Native sign-in: MSAL for iOS with authorization code plus PKCE, a public client, scope `access_as_user`, and a mobile redirect URI registered in Entra. The session token lives in the Keychain with the class `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. Classes that need an unlocked phone would hide the token when the app wakes in the background, runs a notification action or is used in CarPlay, where the phone is usually locked (the CarPlay developer guide lists them as inaccessible).
- Face ID lock (owner decision, 29 October 2026: on by default, set up at the first sign-in, switch in Settings). It gates the screen, not the token: the app covers its content until `LocalAuthentication` succeeds, with the device passcode as the fallback. It is separate from Microsoft sign-in, needs no backend change and needs `NSFaceIDUsageDescription` in Info.plist. A running voice session is never interrupted by the lock: Mute and End stay on the cover and in the Live Activity. Proposed, not confirmed: a Not now choice at setup, and a lock delay of 1 minute that Settings can change.
- Backend change needed: probably none for HTTP and SSE.
- Source: `apps/backend/src/auth/hook.ts`, `apps/backend/src/auth/verify.ts`.

## 2. Chat (HTTP plus SSE)

1. `POST /conversation/sessions` with `{channel: "chat", language: "da" or "en"}` returns 201 and `{id, ...}`.
2. `POST /conversation/sessions/:id/turns` with `{text (1 to 20000 characters), attachmentIds (up to 5), screenContext}` answers as a server-sent event stream.
3. Stream events: `user`, `delta {text}`, `acknowledgment`, `food_invitation`, `interrupted`, `done`, `error`.
4. Reattach after a drop: `GET /conversation/turns/active`, then `GET /conversation/turns/:messageId/events`. Cancel with `POST .../cancel`. The web client retries reattaching for up to 15 minutes, 2 seconds apart.
5. History: `GET /conversation/history?limit=50&before=CURSOR&sessionId=ID` returns `{messages, nextCursor}`.
6. Attachments: `POST /conversation/attachments` as multipart, one file up to 20 MB, returns `{id, name, contentType, size, status}`.
7. Tool calls are not streamed as their own events. Read them from `toolCalls` in the final history, or from the confirmation text.
8. Errors: 401 sign in again, 403 not the owner, 429 wait for `Retry-After`, 503 try again later.

## 3. Voice (WebSocket)

- URL: `wss://BACKEND/voice` (English) or `wss://BACKEND/voice/da` (Danish). It is a WebSocket carrying JSON, not WebRTC.
- Auth: two subprotocols, `jarvis.voice.v1` and `jarvis.auth.TOKEN`. UNVERIFIED: whether an `Authorization` header on the upgrade request is also accepted.
- Audio: base64 PCM16 little-endian, mono, 24 kHz inside JSON messages. There is no Opus.
- The microphone is open (no push to talk). Starting to speak during playback must stop playback at once.
- Client sends: `input_audio_buffer.append {audio}`, `jarvis.microphone.active`, `jarvis.microphone.muted`, `jarvis.session.end`, `jarvis.camera.state`, `jarvis.voice.playback.completed {responseId, audible}`.
- Server sends: `jarvis.session.ready` (with a numeric session id), `jarvis.session.ended`, `conversation.item.input_audio_transcription.completed`, `input_audio_buffer.speech_started`, `response.created`, `response.audio.delta` or `response.output_audio.delta {delta}`, `response.done` or `response.cancelled`.
- Reconnect: exponential backoff, up to 8 attempts, at most 10 seconds apart.
- Source: `apps/web/src/voice-client.ts`, `apps/backend/src/voice/`.

## 4. Generated views

- Shape: `GeneratedView`, version 1, in `packages/contracts/src/index.d.ts` with runtime guards in `index.js`. It is JSON, not Zod.
- Renderers: table, list, detail, text (plain or markdown), timeline, chart (line, bar or area, up to 5 series and 1000 points), task-card, status, image, html-app, knowledge-graph, code.
- Actions (up to 10 per view): open-route, open-link, call-tool, window.
- Native decisions still open: html-app (a stored HTML artifact of up to 512 KiB; needs a sandboxed web view), knowledge-graph, and code.

## 5. App control (workspace commands)

- Stream: authenticated SSE at `GET /now/events` with the events `workspace-ready`, `workspace-command`, `workspace-cancel`.
- Register: `POST /now/workspace/state` with `{sessionId, snapshot}`. The most recent snapshot marks the active client.
- Acknowledge each command within 10 seconds: `POST /now/workspace/commands/:commandId/ack` with `{sessionId, applied, outcome, reason}`. At most 8 commands are pending, and a command id is idempotent by payload fingerprint.
- A command `target` is `active`, `desktop`, `phone` or `all`.
- UNVERIFIED: replay after an SSE reconnect, which commands are desktop only, version negotiation, and how the phone and the desktop choose the active client.

## 6. Tools

- `GET /tools` lists them. `POST /tools/:toolName` runs one and returns `{tool, outcome: "ok" or "refused" or "error", result, confirmation}`.

## 7. Approvals from the Lock Screen

Decision (owner, 29 October 2026): approving from the Lock Screen is allowed and must not be blocked.

What exists today, read from `apps/backend/src/core/now.ts`, `owner-interactions.ts` and `index.ts` on 29 October 2026:

- `GET /now` lists the pending confirmations as `{id, actionKind, summary, expiresAt}`. `GET /now/events` carries `refresh` and `status` events (kind `approval_pending`) from the same hub.
- `POST /now/confirmations/:id` with `{decision: "approve" or "reject"}` resolves one. The id is a 43-character base64url string. It answers 204 on success, 403 for anyone except the owner, 404 when the confirmation is unknown, expired or already used, and 503 when the service is not available.
- A confirmation lives 5 minutes and is single-use: the approval is consumed once on the server before the action runs.
- The pending confirmation is held in the memory of the one backend instance (the deployment is fixed at one replica), so a restart ends it. The app treats 404 as no longer available.
- Today the only hook when a confirmation is created is `onConfirmationPending`, and it feeds the in-app event stream, not a push.

Native design (my call, reversible, not owner-confirmed):

- A notification category with Approve and Decline, both marked `.authenticationRequired`, so the phone asks for Face ID or the passcode before the action runs.
- The action handler makes one short authenticated `POST /now/confirmations/:id` and ends. It reads the session token from the Keychain, which works because of the class in section 1.
- Only yes or no decisions get actions. Anything with more than two options opens the app.
- The notification text names exactly what is being approved, taken from `summary`.
- If the request fails, the handler posts a notification that says to open Jarvis. It never reports a success it did not receive.
- When the confirmation is resolved elsewhere (the web app or a voice session) or expires, the backend updates or removes the notification, so a stale Approve button cannot sit on the Lock Screen.

## 8. New backend work the app needs

| Item | Why |
|---|---|
| Device registration endpoint plus a small SQL table | Store push and Live Activity tokens per device. |
| APNs sender in the backend, key held in Key Vault | Push for "a task needs a decision", task progress and Live Activity updates. |
| Push when a confirmation is created | Added next to `onConfirmationPending`. Carries the confirmation id and the summary. |
| Update or remove the notification when a confirmation resolves or expires | Keeps a stale Approve button off the Lock Screen. The route already answers 404 for a stale one. |
| Entra mobile redirect (a registration change, not code) | Native sign-in. |

The approve and decline route itself needs no change.

## 9. Unverified (test on a real device)

- Background audio, Bluetooth and route changes, microphone recovery after a lock or a call, and how long a WebSocket survives in the background.
- Any absolute limit on voice session length.
- Attachment type allowlist and rate quotas.
- Tool and error event shapes on the voice socket.
- Starting the microphone from a locked phone (Action Button, a shortcut or a Lock Screen control), and what the Face ID lock does to it.
- How an approval notification behaves when the system hides previews on the Lock Screen. If the text cannot be shown, the actions must not be offered blind.
- Whether Approve and Decline appear and work on the Apple Watch, including the authentication step.
- The passcode fallback of the Face ID lock on a cold start, on return from the background and in CarPlay.
- Whether App Intents (Action Button, shortcuts, Siri phrases) need no capability tick. About 90 percent sure; confirm when the first one is built.

## 10. Later surfaces (owner intent, not version 1, nothing authorised)

- CarPlay: the voice-based conversational category would use the same voice WebSocket. The phone is usually locked in the car, so everything it needs must be readable after the first unlock (section 1). CarPlay shows no notifications for conversational apps, so nothing in the car can depend on one. The build plan holds the entitlement steps and limits.
- Apple Watch: Live Activities appear on the Watch without extra work. A native Watch app is outside version 1.
- Music: Jarvis can ask Apple Music (MusicKit) or another player to start something. It cannot be the CarPlay audio app, because an app has one CarPlay category.
