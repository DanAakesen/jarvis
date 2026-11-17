# Map and route card: design brief

Issue #1944. Status: **design brief, written before the designs. No app code, no portal change and no build.**

This brief tells the owner what a map and route card can show, what it costs, and what must be true in the contract, so he can turn it into designs. Facts about today's code are labelled **Today**. Targets and advice are labelled **Proposal**. Things the owner must decide are in section 12. Where a fact comes from Apple's documentation and not from this repository, it is labelled **Apple** and should be re-checked when the build starts.

## 1. What the owner asked for

Owner, TestFlight build 112:

> "This is also very good. But I want a card that shows the map and routes. Is that possible? There is a maps integration I believe we did set in the developer portal. What it did now is also good. The link opens the route in Apple Maps. And the agenda opens directly in the MS events app, good experience."

So: keep the current link to Apple Maps (he likes it), and add a card in Chat and Voice that shows the map and the route.

## 2. Short answer

Yes, it is feasible. Two corrections to the premise:

1. The portal setup is real but is **not** what a route card needs. The Maps capability recorded on 9 November 2026 is Apple's routing-app capability (an app that provides directions *to* Apple Maps, **Apple**). Showing a map, a route line and an ETA inside Jarvis needs no portal capability and no key when MapKit runs on the device. A key is needed only if the **backend** asks Apple for routes (section 7).
2. The route link he likes today is not produced by app code. See section 3.

## 3. What exists today

| Area | Today | Source |
| --- | --- | --- |
| Block contract | Version 1 with three types: `forecast`, `chart` and `view`. A block is data only; the model picks the type through the `show_in_chat` tool, the server validates it and stamps the id and issue time. Limits: 8 blocks per message, 64 KiB per block. | `packages/contracts/src/chat-blocks.js`, `apps/backend/src/core/chat-blocks.ts` |
| Block persistence | Blocks are stored inside the assistant message and returned by history. Nothing refetches or regenerates a stored block. | `docs/architecture.md` (Conversational blocks), PR #1933 |
| Block rendering | iOS only. `ChatBlock` decodes unknown types leniently into `unsupported` and shows a readable fallback. The web chat shows reply text only. | `ChatBlock.swift`, `JarvisChatBlockView.swift` |
| Voice | The Voice bottom panel (PR #1934) shows generated **views**, not blocks. It has close, expand and collapse and sits between the status and the controls. | `VoiceContentPanel.swift`, `DESIGN.md` |
| Links in blocks | `open-link` is limited to HTTPS on two hosts (`github.com`, `learn.microsoft.com`). `maps.apple.com` is not allowed, so a block cannot carry an Apple Maps link today. | `packages/contracts/src/index.js` (`linkHosts`) |
| Apple Maps link | **No repository code builds an Apple Maps link.** The owner's route link is therefore most likely a plain HTTPS link the model writes in its reply, opened by the system (inferred, not verified). The agenda link to the Microsoft events app is also not built here. | Search of `apps`, `agents`, `packages` and `docs` for Maps URLs found nothing |
| MapKit | **Not used.** No `import MapKit`, no `MKMap*` types. | Search of `apps/ios` |
| Entitlements | `Jarvis.entitlements` holds push, HealthKit, the Microsoft keychain group and the App Group. No Maps entitlement. `project.yml` lists HealthKit as the only system capability. | `apps/ios/Jarvis/Jarvis.entitlements`, `apps/ios/project.yml` |
| Portal record | Maps, WeatherKit, Associated Domains, CarPlay Voice Based Conversation and Push to Talk were enabled on 9 November 2026. The note says which App IDs received them was not recorded, and that enabling a capability does not implement behaviour. | `docs/ios/apple-capabilities.md` |
| Maps identifier or key | **No record** of a Maps identifier or a Maps private key anywhere in docs, infra or workflows. | Search of `docs`, `infra`, `.github` |
| Location | The app asks for Location Services while in use and reads one coarse fix (kilometre accuracy), at most once per hour, saved as the home city and coordinates for the weather tool. The permission text says "approximate location for local weather". | `JarvisDeviceLocation.swift`, `Info.plist` |
| Routing data | The backend has **no** directions or ETA source. The weather tool geocodes city names through Open-Meteo only. | `apps/backend/src/core/weather.ts` |

## 4. What is feasible

| Capability | On the device (MapKit, no key) | On the backend (Apple Maps Server API, needs a key) |
| --- | --- | --- |
| Static map image with pins and a route line | Yes. `MKMapSnapshotter` renders an image; the route line is drawn on top. | Not applicable (images are rendered on the device) |
| Live, pannable map | Yes (SwiftUI `Map`), but not good inside a scrolling chat: gestures fight the scroll and every card holds a tile session. Fine in a full-screen or sheet view. | Not applicable |
| Route line (polyline) | Yes, `MKDirections` returns the geometry. | Yes, the directions endpoint returns it (**Apple**). |
| Distance and ETA | Yes, with current traffic. | Yes (**Apple**). |
| Travel mode | Driving and walking are sure. Transit and cycling: **unverified**; check per region at build time. Where a mode cannot be routed, the card says so and offers only Open in Apple Maps. | Check which modes the service supports (**Apple**). |
| Origin = where the owner is now | Yes (needs a finer fix than today's coarse one). | No. The backend only knows the saved home city, not live position. |
| The model knows the ETA and can say it | No. The device computes after the model has answered. | **Yes.** The tool result goes back to the model, so Voice can speak "about 25 minutes". |
| Works on another device or the web | Only where the app runs MapKit. | The stored data renders anywhere. |

Tiles always need a network. Route geometry, distance and ETA do not, once stored.

## 5. What the card shows (content, not design)

One card, one headline (the destination), no eyebrow and no subtitle.

- **Map area** with the route line, an origin marker and a destination marker. Fit to the route with padding.
- **Headline**: destination name. Body: address or area when it adds something.
- **Facts line**: travel mode with its icon, duration, distance and, for driving, the arrival time. Example: "Driving, 25 min, 18 km, arrive 15:40".
- **As-of note**: "Estimate as of 14:55". An ETA is never presented as live.
- **Actions**: one primary, **Open in Apple Maps** (keeps the behaviour he likes). A second, **Expand**, opens a larger interactive map in a sheet. No other controls in v1.
- **Alternatives**: none in v1. One route.

## 6. Data contract additions (Proposal)

A new block type `route`. The block version stays 1 because unknown types already decode into the readable fallback on old builds, so the change is additive (see section 11 for the catch).

Stored shape (`data`):

| Field | Meaning | Limits |
| --- | --- | --- |
| `mode` | `driving`, `walking`, `transit`, `cycling` | enum; the card shows only what the source returned |
| `origin` | `{ name, latitude, longitude, kind }` where `kind` is `device`, `home` or `place` | name 1 to 100 characters; latitude -90 to 90; longitude -180 to 180 |
| `destination` | `{ name, address?, latitude, longitude }` | name 1 to 100; address up to 200 |
| `route` | `{ distanceMeters, durationSeconds, trafficAware, computedAt, polyline }` | distance 0 to 10,000,000; duration 0 to 172,800 |
| `route.polyline` | Simplified list of `[latitude, longitude]` pairs, 6 decimals | 2 to 500 points (about 12 KiB, well inside the 64 KiB block limit) |
| `status` | Reuses the existing source `status` and `reason` (`complete`, `partial`) | `partial` when the mode could not be routed |

Rules:

- **The model never writes geometry.** A route tool returns a `routeId` plus the values the model needs to speak (duration, distance, destination name). The model then submits `show_in_chat` with `{ type: 'route', data: { routeId } }` and the server swaps in the stored route, the way it already stamps the id and the issue time. This avoids invented coordinates and keeps the block inside validated bounds.
- **No Apple Maps URL in the block.** The Open in Apple Maps action is a typed client action built from the destination coordinates and name (`open-in-maps`), not an `open-link`. That keeps the link allow-list unchanged.
- Validation follows the existing style: only known keys, finite numbers within the ranges above, one `source` with a label and `issuedAt`.
- The input JSON schema (`createChatBlockInputSchema`) gets a `route` branch that accepts only `routeId`; the stored validator accepts only the full shape.
- iOS: a `route` case in `ChatBlock` with lossy decoding, like the others, and a text alternative for accessibility.
- Voice: the Voice panel renders views only today; it needs to host `route` blocks too (open question 6).
- Web chat keeps showing reply text only; the `summary` is the readable version.

## 7. What needs a developer-portal or entitlement change

Depends on the option (section 10).

| Item | Option 1 (pin) | Option 2 (device route) | Option 3 (server route) |
| --- | --- | --- | --- |
| Capability on the iPhone App ID for showing maps | None | None | None |
| App entitlement for MapKit | None | None | None |
| The existing Maps capability (routing apps) | Not needed | Not needed | Not needed |
| A Maps identifier in the portal | None | None | **Create one** |
| A private key for Apple Maps services, tied to that identifier | None | None | **Create one**; it can be downloaded once |
| Backend secret | None | None | Store the private key, its key identifier and the team identifier in Key Vault, read by the backend's managed identity. Never in the repository, the app or logs. |
| `Info.plist` | Reword the location purpose string if "from here" is used | Reword (must cover routes, not only weather) | Reword if "from here" is used |

The owner action in Option 3 is therefore: in the Apple Developer portal, create one Maps identifier and one Maps private key for it, then hand the key to the backend through Key Vault (a one-off step, the same pattern as the push key). The Apple Maps service has a daily call allowance; confirm the current figure (**Apple**) before relying on it, though one owner's route requests are far below any plausible limit.

Not required for any option: a new App Group, a new background mode, or a change to the Watch App IDs.

## 8. Placement

**Chat.** The card sits inside the assistant message like the forecast and chart blocks, under the reply text, full width of the message column. The map area has a fixed aspect ratio (about 16:9, capped in height at larger text sizes) so the transcript does not jump when the image arrives. The reply text still says the answer in words ("About 25 minutes by car"); the card adds to the reply and never replaces it.

**Voice.** Jarvis speaks the answer; the card appears in the bottom panel between the status and the controls, as with other generated content. The orb, status and the four controls stay in view. The panel starts collapsed to the map and facts line; Expand shows the larger map. Close dismisses the panel and keeps the session.

**Link to Apple Maps.** The existing behaviour stays: the model may still write a link, and the card's primary action does the same through MapKit's own open-in-Maps call.

## 9. Behaviour rules

### History snapshot rules

- A stored `route` block is a snapshot. Opening history, scrolling, restarting or changing device **never** recomputes the route, the distance or the ETA.
- The card always shows when the estimate was made. An old card is not "wrong"; it is labelled as of its time.
- Map **tiles** may be requested again when the card is drawn, because an image of the stored geometry needs them. That redraws the same stored route on the current map and is not a refetch of route data. With no network the map area shows a neutral placeholder and the facts stay readable.
- Open in Apple Maps hands the destination to Apple Maps, which plans a fresh route with current traffic. That is expected and is the only live path; the button says "Open in Apple Maps", not "refresh".
- No automatic refresh in v1. A refresh is a new question to Jarvis and a new block.

### Privacy (location)

- Today the app reads a coarse fix hourly and saves a **city** and coordinates for weather. A route from "here" needs a finer, one-off fix. Proposal: ask for it only when a route from here is requested, use it for that request, and do **not** save it to settings or the vault.
- The stored block holds the origin. An origin of kind `device` is a precise position inside a stored message. Proposal: store it **rounded to the nearest 100 metres** and name it "Your location" instead of an address.
- A `home` origin reuses the saved home location. A `place` origin is a named place the owner mentioned.
- Location permission wording must say routes and distance, not only weather. If permission is denied, the card is not shown; Jarvis says in text what it needs (no silent substitution of the home location for "here").
- Third parties: Option 2 sends origin and destination to Apple Maps through MapKit on the device. Option 3 sends them from the backend to Apple's service. Neither uses another map provider. Do not log coordinates; log only the mode, the status and the duration of the call.
- The stored message is visible to the owner only, as other blocks are.

### Loading, error and empty states

Every state is stated in words, with an icon, never by colour alone.

| State | What the owner sees |
| --- | --- |
| Loading (device route or snapshot render) | The card frame at its final size, a neutral placeholder in the map area and "Planning the route". Never a spinner alone. |
| Ready | Map, facts line and as-of note. |
| Partial | Map with the destination marker and no line when the mode cannot be routed; the reason in text ("Transit routes are not available here"). Open in Apple Maps still works. |
| Destination not found or ambiguous | No map. Text asks which place was meant. Jarvis does not guess between places. |
| No location permission (route from here) | No card. Text says why and how to allow it. |
| Offline or service error | Facts from the stored data remain; the map area shows "Map unavailable" and a reason. A new request is a new question. |
| Empty | Not a state: a route block without a route is not created. |

### Accessibility

- The map is decorative to VoiceOver. The card is one element read as text: "Route to the destination, driving, 25 minutes, 18 kilometres, estimate as of 14:55". The `summary` field already exists for this.
- Facts and states are text; the mode is shown with an icon plus its word.
- Controls are the shared buttons (`JarvisLabelledButton`, `JarvisIconButton`) with targets of at least 44 pt and visible focus.
- Reduce Motion: no animated route draw-in; the line appears with a fade. Reduce Transparency: an opaque surface behind the facts.
- Larger text: the facts line wraps; the map keeps its ratio and is capped in height; nothing is truncated without a way to read it.
- The route line and markers must keep contrast against both light and dark map styles; use a halo and different shapes for origin and destination, not colour alone.
- The expanded map's controls are reachable by keyboard and VoiceOver; the sheet has a labelled Close.

## 10. Options

### Option 1: Pin card (no route)

The model supplies a destination name and coordinates; the device shows a snapshot with one pin and **Open in Apple Maps**. No route line, no ETA.

- Pros: no portal change, no key, smallest build, nothing to go stale.
- Cons: it does not show the route, which is what he asked for. It is a prettier link.
- Portal change: none.

### Option 2: Device route card

The block carries the destination, mode and origin kind. The iPhone computes the route with MapKit when the card first appears and keeps the result **on that device** as the frozen snapshot.

- Pros: no portal change, no key, no backend route source; "from here" works with a finer fix; the same code serves Chat and Voice.
- Cons: the model cannot say the ETA, because the device computes after the answer. The stored message has no route, so another device or a reinstall shows the unrouted state (destination, Open in Apple Maps). The snapshot is not part of history, which conflicts with "stored blocks are the record".
- Portal change: none.

### Option 3: Server route card (recommended)

A backend `route` tool asks Apple Maps for directions, stores the validated result, tells the model the duration and distance, and the block carries the polyline. The iPhone draws the stored geometry with MapKit.

- Pros: the route is data in the message, so history is a true snapshot on every device; Jarvis can speak the ETA in Voice and Chat; the contract is validated like every other block and the model cannot invent geometry.
- Cons: one owner action in the portal (a Maps identifier and key) and a new backend secret; the backend does not know the live position, so "from here" needs the device to send one rounded coordinate with the request (a new, narrow privacy surface), or the route starts from the home location or a named place.
- Portal change: yes, section 7.

### Recommendation

**Option 3**, built in two small steps so the owner sees value early: (a) the `route` block with a named origin and destination, the tool and the card in Chat; (b) "from here", the Voice panel host and the expanded map sheet. It is the only option where the card, the history rule and the spoken answer all agree. If the owner does not want to create a key now, pick **Option 2** and accept that the model stays silent on the ETA and that history on a second device shows the unrouted state. Option 1 is not worth building on its own.

## 11. Risks and limits

- **Old builds.** A build without the `route` case shows the existing "unsupported block" fallback with the summary. The server cannot know a client's build, so the summary must carry the answer in words.
- **Block size.** A long route simplified to 500 points is about 12 KiB. The validator should reject anything larger instead of truncating.
- **Coverage.** MapKit routing coverage differs by region and mode; the card must show Partial instead of guessing.
- **Not verified.** Everything marked **Apple** above, whether the model's own link is really what opens Apple Maps, the mechanism behind the events link, and every rendering and gesture behaviour on a device. Nothing was built or run for this brief.

## 12. Open questions for the owner

1. Pick an option (recommendation: Option 3, in two steps). Is creating a Maps identifier and key in the portal acceptable now?
2. Which travel modes matter first: driving and walking only, or also transit and cycling where available?
3. Is "route from where I am" a must for v1, given it needs a finer location fix and a rounded coordinate stored with the message?
4. Should the stored origin for "here" be rounded to 100 metres and named "Your location", as proposed?
5. Should the primary action only open the route for review in Apple Maps (proposed), or also start turn-by-turn directly?
6. In Voice, should the panel show the route card by default for any spoken directions, or only when asked ("show me")?
7. Should the card offer the arrival time for driving only, or also "leave by" for appointments from the agenda (a later link to the calendar)?
8. Alternatives and multiple stops: out of v1 (proposed)?
9. Dark and light map style: follow the system, or always a dark map to match the glass look?
