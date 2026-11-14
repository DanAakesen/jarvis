# Orb inventory for the cognitive lattice replacement (P15-143)

Written before any implementation, from a search of every tracked file for the word
"orb", for every `JarvisOrb*` / `InputOrbCore` / `createJarvisStageOrb` call site, and
for every other radial or sphere-like drawing (`RadialGradient`, `Circle` marks, the
Watch glyphs). The first column is the surface; the last column is what this change
does to it.

## iPhone app (`apps/ios/Jarvis`)

| # | Surface | Where | Today | Now |
|---|---------|-------|-------|-----|
| 1 | Shared orb component | `JarvisControls.swift` `JarvisOrb`, `JarvisOrbButton` | Wraps `JarvisOrbCanvas` | Wraps the shared lattice renderer; same API and size contract |
| 2 | Orb renderer | `JarvisOrbCanvas.swift` (also compiled into the Live Activity target through `project.yml`) | Dark glass, ribbons, motes, amber tangle (web stage port) | Deleted; replaced by the lattice painter in JarvisCore |
| 3 | Gate: sign-in | `JarvisGateRootView.swift` `JarvisGateSurface` (250 pt, activity `.signingIn` / `.idle`) | `JarvisOrb` | Lattice through `JarvisOrb` |
| 4 | Gate: Face ID lock and loading | same file, non-sign-in branch (250 pt) | `JarvisOrb` | Lattice through `JarvisOrb`; cold start shows the opening screen first |
| 5 | Voice screen | `VoiceScreen.swift` `voiceOrb` (250 pt, activity from voice state and mute) | `JarvisOrb` | Lattice; listening, thinking and speaking keep their contracts |
| 6 | Home composer orb button | `JarvisOrbButton` | Defined, no caller today | Same lattice; kept as the shared control |
| 7 | Component gallery | `JarvisComponentGallery.swift` (44, 96, 160 pt; calm, listening, thinking) | `JarvisOrb` | Lattice; gallery shows every state and the opening building blocks |
| 8 | Lock-screen approval preview | `JarvisLockScreenTasksPreview.swift` (38 pt) | `JarvisOrb` | Lattice |
| 9 | App icon (iPhone) | `Assets.xcassets/AppIcon.appiconset` | Old blue glass orb with orange atom | Generated from `cognitive-lattice-transparent.png` |
| 10 | Launch screen | `Info.plist` `UILaunchScreen` (empty) | System default | Static colour equal to the opening background |
| 11 | Chat, Settings, Factory, Health, Notes, Today, Usage, Status, Proactive | all of `apps/ios/Jarvis` | No orb drawn (searched; only `ProgressView`-style `JarvisLoadingView` dots) | Nothing to replace. They stay orb-free; nothing may draw one in a screen file |

## Live Activity and Dynamic Island (`apps/ios/VoiceActivity`)

| # | Surface | Where | Today | Now |
|---|---------|-------|-------|-----|
| 12 | Dynamic Island expanded leading (30 pt) | `JarvisVoiceActivity.swift` `VoiceActivityMark` | Static `JarvisOrb` | Static lattice |
| 13 | Dynamic Island compact leading and minimal (18 pt) | same | Static `JarvisOrb` | Static lattice, minimal detail level |
| 14 | Lock-screen Live Activity (46 pt) | `VoiceLockScreenView` | Static `JarvisOrb` | Static lattice |

## Home-screen widgets (`apps/ios/Widgets`)

| # | Surface | Where | Today | Now |
|---|---------|-------|-------|-----|
| 15 | Small widget (36 pt) | `JarvisHomeWidgetViews.swift` | `JarvisWidgetOrb` (hand-drawn simplified tangle) | Static lattice from JarvisCore |
| 16 | Medium widget (40 pt) | same | `JarvisWidgetOrb` | Static lattice |
| 17 | Large widget (52 pt) | same | `JarvisWidgetOrb` | Static lattice |
| 18 | Factory, Gym and Notes widgets | `JarvisFactoryWidgetViews.swift`, `JarvisGymWidgetViews.swift`, `JarvisNotesWidgetViews.swift` | No orb | Nothing to replace |

## Apple Watch (`apps/ios/Watch`, `apps/ios/WatchWidgets`)

DESIGN.md said "The Watch uses a glyph rather than an orb". The owner has ruled
"this is app wide, everywhere", so the Watch glyph for Jarvis voice is the orb now.

| # | Surface | Where | Today | Now |
|---|---------|-------|-------|-----|
| 19 | Home action "Voice" / "Resume voice" | `JarvisWatchApp.swift` -> `JarvisWatchAction(kind: .voice)` -> `WatchGlyph.voice` | `WatchWave` amber bars | Lattice orb |
| 20 | Lift capture "Voice" action | `WatchLiftCaptureView.swift` | `WatchWave` | Lattice orb |
| 21 | Chat composer voice button | `WatchChatView.swift` | `WatchWave` (22 x 18) | Lattice orb |
| 22 | Voice session strip | `WatchChatView.swift` (`model.voiceState`) | Text only | Orb that follows the session state next to the status text |
| 23 | "Voice Session" complication | `JarvisWatchWidgets.swift` (accessoryCircular) | `WatchGlyph(.voice)` | Static lattice orb |
| 24 | Watch app icon | `Watch/Assets.xcassets/AppIcon.appiconset` | Copy of the old iPhone icon | Generated from the concept, framed for the round Watch mask |
| 25 | Dictate, Tasks, Factory, Log lift glyphs | `WatchDesign.swift` | SF Symbols and mini wave | Not Jarvis orbs; unchanged |

## Web (`apps/web`)

| # | Surface | Where | Today | Now |
|---|---------|-------|-------|-----|
| 26 | Stage orb (persistent, docked behind pages, voice and chat state) | `JarvisStage.tsx`, `jarvis-stage-scene.ts`, `JarvisStageOrb.ts` (Three.js, shader shell, ribbons, motes, amber core) | Three.js glass sphere | Procedural lattice in the same scene, same `jarvis-orb-motion.ts` states |
| 27 | Composer voice orb (`.input-orb`) | `VoiceControls.tsx` -> `InputOrbCore` | 2D canvas, miniature core | Same lattice generator, 2D canvas |
| 28 | Rail chat orb (off the home page) | `App.tsx` (`rail-chat-orb`) -> `InputOrbCore` | same | same |
| 29 | "Jarvis is working" core in chat | `ToolCallChip.tsx` -> `InputOrbCore variant="core"` | Amber tangle alone | Lattice core variant |
| 30 | Orb colours | `jarvis-orb-appearance.ts` (+ test) | cool `#52dcfa`, warm `#ff8738` | New amber appearance, kept in step with `JarvisOrbAppearance` |
| 31 | Favicon and web manifest | `public/favicon.svg`, `manifest.webmanifest`, `index.html` | Dark tile with a white J | Generated from the concept |
| 32 | Voice status text, flight animation | `VoiceOrbStatus.tsx`, `chat-flight.ts` | Text and a DOM animation toward the rail orb | Not drawings; unchanged |
| 33 | Knowledge graph scene | `knowledge/knowledge-scene.ts` | A graph, not an orb | Unchanged |

## Not product surfaces (left alone, listed so nobody searches again)

- `docs/ios/design/*.html`, `orb-web.js` and `docs/ui/concepts/*`: historical design boards.
- `docs/ui/screenshots/**`: past evidence images.
- Backend, agent and runner hits for "orb" are the substrings of "absorb", "forbidden" and similar.

## Shared-state contracts that stay

`JarvisOrbState` (idle, listening, thinking, tool, speaking), `JarvisOrbActivity`
(idle, signingIn, calm, listening, thinking, speaking, muted, reconnecting, offline),
the wake timeline in `JarvisOrbMotion`, and the web `OrbMotionFrame`. The lattice reads
those weights and levels; it does not add new states and does not touch the microphone.
