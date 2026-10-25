# Camera preview verification (#1283)

All images are Chromium screenshots of the composed `Workspace` using a generated
canvas stream with colored shapes and dimension labels. No camera hardware,
private image, or live service was used.

The 320×700 touch-phone screenshots cover a 360×640 portrait source, same-stream
switch to 640×360 landscape and back, the Front status badge, full unknown-
direction status, visible observation and playback recovery, and a scrolled
feedback panel. The 1440×1000 desktop screenshot uses the portrait source.

`measurements.json` records the viewport, source and rendered dimensions, status
line count, frame styles, and switch/close positions for each screenshot. At
320×700 the portrait surface is 189×336 px, the landscape surface is 281.6×158.4
px, and both 44×44 px controls remain inside the visible video after either
orientation change. The Front status text stays on one line. The observation
notice and playback retry fit together in the video overlay; scrolling that
feedback panel does not move the controls.
