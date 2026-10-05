# Accepted Jarvis stage prototype

Read-only reference for the implementation tasks in [the plan](../../../PLAN.md). This is the centred browser motion study Dan accepted on 5 October 2026. It contains illustrative comparison data and simulated chat/voice states; it never accesses the microphone, camera, screen, GitHub or an AI API. Do not deploy this demo instead of the real app.

The 3D stage and persistent orb belong only on the Jarvis typing/voice page. Light mode must re-light the same room. The current prototype implements dark appearance only; production light appearance remains planned.

[Selected images and browser captures](../../ui/centred-stage/README.md) show the target. [ui.md](../../../ui.md#accepted-centred-3d-stage--5-october-2026) records the requirements. The approved floor mirror and wake-up behaviour are retained. Dan reports flickering during transitions: this is unresolved and the older passing interaction checks do not establish flicker-free rendering.

## Run

Use the repository's Node/npm toolchain. The original cloud prototype was built with Node 24.19.0 and npm 11.9.0; source compatibility with the production Node 22 toolchain is an implementation check, not a claim from this handoff.

```bash
cd docs/reference/ui-stage-prototype
npm ci
npm run dev -- --host 0.0.0.0 --port 4173 --strictPort
```

Serve `jarvis-centred-stage.html` through a local HTTP server for the self-contained version. No external assets are requested by that artifact. Its SHA-256 is `896dfe11aafc7be2312a7acb77033afd66f355e67fe0a790e91aee0202750d25`; it is copied without rebuilding or modifying the accepted file.

```bash
npm run build
python pack-standalone.py
```

Packaging writes a new `jarvis-motion-study.html`; it does not overwrite the accepted snapshot.

## Evidence and limits

The existing Python checks require Playwright, Pillow and `/usr/bin/chromium`. `python stage-check.py` serves the accepted standalone and exercises its core, interactions, shared centre, lighting, independent mechanism rotation and phone layout. Other checks accept `JARVIS_PROTOTYPE_URL` to target a running server. Result JSON files in `captures/` are historical evidence from the earlier cloud runs, not results of the documentation handoff. New checks can overwrite those result files locally; do not treat their filenames alone as proof of current verification.

Software WebGL checks were run in the cloud. Hardware GPU performance, battery use, Safari, physical-phone interaction and real voice integration remain unverified. Transition flicker remains a reported defect. Preserve both limitations in implementation PRs until verified.

Three.js and bundled Phosphor icons use MIT licences included in [licenses](licenses/). The prototype has its own lockfile and is not a root npm workspace. Future workers port the selected scene into the existing React app and reuse its auth, chat, voice, activity and workspace contracts.
