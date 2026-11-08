# Native Watch simulator evidence

Captured by [PR-only CI run 42512941709](https://github.com/DanAakesen/jarvis/actions/runs/42512941709) at source `67d85cf980f4cf6a9b4b6f8fef4ab54042b215c1`, using Xcode 26.6 and an available Ultra-family simulator. Raw PNGs are 422 × 514 pixels. These are synthetic DEBUG `--watch-fixture` views, with no backend requests or real health information. They are not physical Ultra 2 acceptance evidence.

- [Home](home.png): all three actions visible, compact heading/menu.
- [Chat](chat.png): user bubble, assistant reply, compact input bar with mic and voice controls. Tapping the draft opens the native editor; Send appears for a nonempty draft.
- [Health](health.png): the shared rectangular health layout mounted inside the app for inspection. This is **not** a watch-face complication capture. Actual face sizing, circular complications, tint and Always On still need owner-device acceptance.

Unsigned Watch/widget and full paired iPhone builds passed in that run. See [implementation handoff](../implementation.md) for tests and remaining checks.
