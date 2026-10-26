# Startup navigation correction #1299

These are synthetic captures of the actual App in Chromium mobile emulation at
390px width, with mocked authentication/API responses. No private owner images,
real account, camera or microphone are used. They are not physical iPhone evidence.

## Reproduced cause

On released main `9f743499ed3b2647a48da1411948bd5329010c89`, before any input,
tap, fill or focus in the browser fixture, the App had `activeElement.id=message`,
`innerHeight=visualViewport.height=844`, `data-keyboard-open=true`, and hidden
navigation. `before-startup-390x844.png` records that synthetic failure.

`ConversationHistory.tsx` focuses the input in its initial idle effect (and after
busy states), with another deferred restoration effect when hosted history closes.
The viewport hook treated the first focus measurement as typing without requiring
any geometry change. An outside touch blurs the input and clears that state.
That source path matches the owner's reported sequence, without establishing the
exact physical iPhone event ordering or browser mode.

The correction uses the earlier observed viewport height when focus begins,
instead of treating focus itself as keyboard evidence. It retains height history
for resize-before-focus, and existing inset/dismissal/control-handoff handling.
A fresh short viewport with neither inset nor earlier height is ambiguous and
keeps navigation visible. Startup focus behavior itself is unchanged.

## Inspected captures and assertions

- `startup-390x844.png`: untouched startup; input is focused but navigation visible,
  composer bottom 760px. The fixture takes this before manipulating the input.
- `typing-390x480.png`: all three viewport heights shrink to 480px; navigation
  hidden, composer bottom 472px. Plus opens and closes on repeated presses without
  moving the composer or restoring navigation during typing.
- `restored-390x844.png`: expansion restores navigation while focus stays in input.
- `startup-short-390x480.png`: fresh short reload has no keyboard evidence; navigation
  remains visible and draft survives. A later shrink to 300px hides it again.

Also asserted resize-before-focus, outside focus departure, no horizontal overflow
(measurements record 390px document width), and zero page errors. All five images,
including the before capture, were visually inspected. `measurements.json` stores
final geometry. The full and focused test results are recorded in the PR receipt.
Two initial autofocus cases failed on released code before the correction.

## Reproduction

Use the existing web/contracts installation and Vite dev server on port 5173.
Temporarily copy `../mobile-corrections-1293/fixtures/qaapp1293.html` and `.tsx` into
`apps/web/`, run `python docs/ui/screenshots/startup-navigation-1299/fixtures/browser.py`,
then remove those two temporary files before lint/build. Python Playwright and
`/usr/bin/chromium` are required. The script uses `/workspace/jarvis` for its output.
All assertions render real App components; no product-only mock UI is substituted.

## Limits

Synthetic Chromium does not reproduce a native iOS keyboard. A keyboard already
open before a fresh mount, with equal layout/visual heights and no earlier height
or inset evidence, is indistinguishable from a short keyboard-free viewport;
focus alone deliberately does not hide navigation. Physical iPhone acceptance is
still separate. No private screenshot was downloaded or published for this task.
