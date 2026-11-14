# Jarvis selected opening screen

Implement the selected app-owned opening/loading screen using `jarvis-opening-selected.png` as the visual reference. This brief combines option 1's composition with option 2's network background. The composition is owner-selected; the motion timings below are proposed implementation targets to refine on device. This delivery contains a static mockup and specification, not an implemented animation.

## Composition

- Keep option 1's complete, centered Cognitive lattice orb and the white **Jarvis** name centered beneath it. Preserve the bright connected dots, fine angular web, depth, amber core and cyan glass edge. The connections should resemble an advanced connected brain.
- Use option 2's near-black navy background with sparse, dim cyan lines and nodes extending to the edges. Keep it quieter than the orb. The background can remain static.
- Remove the visible **Opening…** text. Place a slim progress bar in that same lower centered location: approximately 40% of the available screen width, 3 points high, rounded ends, subtle dark blue-gray track and warm amber active segment. No visible percentage or loading caption. The partial fill in the mockup is illustrative.
- Adapt the composition to safe areas and different screen sizes; the raster is not a pixel-perfect SwiftUI measurement. Keep the wordmark clear of the orb and the bar clear of the home indicator.

## Loading motion

Keep the outer glass sphere, rim and overall position steady. Animate the internal network as connected geometry: neighboring nodes illuminate in short sequences; faint cyan signals travel along existing connections toward the amber core; small inner clusters gently shift in depth while preserving their connected web. Give the core a restrained warm pulse about every 1.6 seconds. Paths can overlap asynchronously so the network feels alive without flashing or spinning the entire sphere. Avoid abrupt topology changes. Do not animate the whole PNG as a substitute for internal motion.

Use a filled progress bar only when actual work provides reliable measurable progress. If startup progress is unknown, use a custom moving amber segment within the same track, with indeterminate accessibility semantics. Do not simulate a percentage, use arbitrary stage weights, or advance on a timer. This custom linear activity treatment is a requested design, not a claim about the default iOS spinner. Stop or replace loading feedback with the existing error/retry state if startup fails.

## Transition to Home

Run startup work concurrently with motion. Enter Home as soon as the minimum usable screen and required authentication are ready; remaining nonblocking content can load in Home. Do not wait for every service or force the user to watch a complete animation cycle.

On genuine readiness, finish a determinate bar at 100%; stop an indeterminate segment without implying measured completion. Crossfade the loading composition into the real Home view over approximately 300 milliseconds with a smooth ease-out. Keep dark background colors aligned to avoid a black or white flash. Fade the orb, name and bar together while Home content appears; do not shrink the orb toward an invented destination. Keep the outer orb stable through the fade. The transition must tolerate interruption and repeated lifecycle events without revealing protected content.

Skip this opening sequence on an already-ready warm resume and preserve existing navigation restoration and deep-link handling. Reduced Motion uses a still orb and a short opacity transition of approximately 150 milliseconds; progress changes remain understandable. Expose a localized accessibility progress label/value without putting the removed loading caption back on screen. Pause decorative rendering when inactive or covered.

## Integration and acceptance

Use the existing shared `JarvisOrb` and its shared renderer for the orb changes. Reuse the project scaffold, shared controls and `jarvisGlassSurface` where applicable; do not draw a separate orb in a screen file. Preserve the existing listening, thinking and speaking state contracts. Loading motion must not activate the microphone or imply that Jarvis is listening. Preserve native authentication, its separate wordmark-free gate, and privacy covers.

The iOS system launch screen remains static and visually aligned with the first app frame. Start this animation only in the running app, not the launch storyboard. Avoid a mandatory branded wait.

Verify on a supported simulator and device: immediate readiness, slow startup, failed startup and retry, interrupted transition, background/resume, authentication, deep links, Reduced Motion, VoiceOver and small-screen layout. Run the repository's relevant checks and design-system guards. Report observed results rather than treating this mockup as runtime verification.

## References

- `jarvis-opening-selected.png`: selected composition, static mockup.
- `approved-cognitive-lattice-reference.png`: approved orb identity and static state studies.
- `cognitive-lattice-transparent.png`: transparent foreground source, not an animated model or finished iOS icon package.
- [Apple: Progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators): accurate progress and indeterminate activity when work cannot be quantified.
- [Apple: Launching](https://developer.apple.com/design/human-interface-guidelines/launching): first-frame continuity and prompt access to the app.

The earlier five-option handoff is superseded for opening-screen selection by this brief. No changes to the Home layout or app-icon packaging are requested here.
