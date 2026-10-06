# Approved unified shell and conversation controls

Dan selected the Luminous Glass component family and the last Architectural Glass shell. The [refined selected image](../shell-styling/README.md#refined-approved-reference) removes both human/Jarvis message avatars, the top-left window header orb/title and separator above messages. The separate bottom app-shell/footer bar is removed; preserve its database-waking feedback in compact top-bar status. Keep the large scene orb, small input voice-start orb and compact voice-session bar.

The original voice/composer comparison below remains the shared material reference; its message avatars are superseded by the refined image. The illustration shows voice and typing controls together for comparison, not simultaneous production modes. Example content is illustrative.

![Original component-family reference; message avatars superseded](luminous-glass-approved.png)

Implementation: [#397](https://github.com/DanAakesen/jarvis/issues/397), P8-36, owns voice/shared menu and is already in progress in PR #403. [#398](https://github.com/DanAakesen/jarvis/issues/398), P8-37, owns shell, composer and avatar-free messages in one PR. #399/#401 are closed as superseded allocations, not implemented work. Wait for #398's blockers and the updated handoff to be on main; consolidation does not start a worker.

## Implementation scope

### P8-36 — #397

Replace the current oversized voice status/control treatment with the selected Luminous Glass bar. Reuse the existing voice runtime and shared appearance tokens; do not replace the room, camera or session engine.

- [ ] Match the approved compact glass bar: More on the left, an understated state glyph and readable runtime status, and End voice on the right. Fine cyan/amber refracted edges and restrained smoky glass must remain readable over the moving room. No large status icon disc or duplicate microphone/screen/camera group in this bar; retain those capabilities and their existing placements.
- [ ] More contains a globe/icon plus Language text, with a flyout for Danish and English and a checked current choice. Remove the large DA/EN toggle. Bind the shared menu to real language/session state, retaining existing rules and truthful feedback for active-session changes; reuse it in the composer.
- [ ] Drive status from the existing runtime: connecting, listening, thinking/tool activity, speaking, reconnecting and failure. Do not imply listening during reconnect or use illustrative reference text as a simulated production state. Keep relevant recovery and End voice reachable.
- [ ] Keep explicit voice activation, ordinary input/history hidden in voice, current window continuity/default-off minimise preference, End voice and keyboard handling. Escape first dismisses a menu/flyout before the existing end-voice action. Do not duplicate the workspace or remount the 3D scene.
- [ ] Extend canonical shared tokens/components rather than creating a second visual system. Verify readable dark/light surfaces, 44px touch targets, focus/keyboard/flyout dismissal, narrow screens and reduced motion. Run relevant web checks and record browser comparison with the reference; distinguish local fixtures from live voice/device acceptance.

### P8-37 — #398 (consolidated)

Deliver the connected shell, composer and message-window change together. One implementation PR reduces repeated CI across separate PRs; updates to that PR still run CI.

- [ ] Implement the coherent selected foreground material/typography across shell, composer and messages: dimensional graphite/smoked glass, restrained cyan/amber refraction, adequate frosted text opacity and purposeful spacing. Extend existing semantic tokens and #397's shared components. Selected/focus states use complete shapes and text/icons, not lone colored accent borders.
- [ ] Keep the bottom-centred composer with small voice-start orb, attachment, usable multiline writing area, More and Send. Use the shared More → icon/text Language row → Danish/English flyout with checked selection; remove the large DA/EN toggle without losing real language/session behavior.
- [ ] Implement the readable message window with constrained line length, clear user/assistant hierarchy and top-right minimise/maximise/close plus an unobtrusive drag region. Remove the separator above messages, top-left header orb/Jarvis title and both human/Jarvis avatar icons inside messages; reclaim the avatar gaps and preserve accessible author roles using alignment/text semantics. Keep the large scene orb and small composer orb.
- [ ] Preserve safe Markdown, genuine tool outcomes and streaming/interrupted/failed-turn content. Auto-follow only while at the latest message; retain manual reading position and an accessible return-to-latest action. Closing/minimising history leaves typing usable and history returns when needed for responses.
- [ ] Preserve Enter/Send steering, safe tool-round message boundaries, Ctrl+Enter FIFO queue/removal, queued languages, drafts, attachments and existing failure/recovery. Send/language/voice remain available during replies. No Stop button, blanket disabling, parallel chat turns, duplicate submissions or replacement conversation/window manager.
- [ ] Style the existing thin full-width top bar, narrow rail below it, closable left navigation, main tabs/workspace and closable right context pane; retain top-right Settings, routes/actions and truthful camera/sharing availability. Add no fake metrics/status, navigation areas or tab-creation affordance from the generated image.
- [ ] Remove the separate bottom app-shell/footer bar and its reserved track/padding across shared desktop/phone pages. Preserve existing database-waking state and accessible live feedback in compact top-bar status, keeping idle chrome quiet and recovery/other operational feedback reachable. Keep the bottom-centred composer and compact voice-session bar.
- [ ] Preserve the same real 3D room, floor reflection, orb lighting/runtime and re-lit dark/light appearances on Jarvis only. Other routes use shared shell materials without room/large orb. Preserve appearance persistence, usable stage composition after the height change, explicit microphone activation, voice/input/history visibility and default-off minimise-on-voice-entry.
- [ ] Reuse workspace commands and window lifecycle: tabs/minimise/restore, drag/resize, focus/z-order, overlap/tile and temporary-view lifetime. Retain phone foreground view/swipe/orb docking, draft/focus return and reversible mode/window continuity; do not remount the scene or invent a second window system.
- [ ] Validate the combined change with relevant web checks and real browser comparisons at desktop/phone widths in dark/light, panels open/closed, long/streamed/tool/error content, database waking, voice/window transitions, keyboard/touch/flyout and reduced motion. Verify no bottom strip, clipping/overflow or lost status; record fixture/software-WebGL versus live provider/device/GPU limits. Deliver all three surfaces in one implementation PR; CI still runs for updates to that PR, rather than three separate PR pipelines.

## Evidence and boundaries

The selected image was edited with Image Gen to apply the two requested header removals; its PNG is checked into this directory. On 6 October 2026, the latest main at `e00e54d3999092e9387dcb505c336d74a038fae2` was run from a fresh worktree with Node 22.23.3 and npm 10.9.9. Dependency installation and the contracts build completed. Chromium captured the actual signed-in shell using a scratch auth fixture and mocked backend responses; production code/auth were unchanged. The capture used software WebGL and does not validate live authentication, Azure APIs, microphone/audio or GPU motion quality. Dan selected Architectural Glass. #398 now owns shell, composer and avatar-free messages together; #399/#401 are closed as superseded. #397 owns voice/shared menu and is in progress in PR #403; #398 remains planned and unclaimed.
