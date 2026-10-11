# Composer sizing

Dan requested that the desktop chat input match the enlarged conversation
window, rather than remaining narrow underneath it.

These are captures of the real local Vite app in Chromium, with intercepted
sign-in and API fixtures. Messages, tools and Usage values are examples, not
Dan's production data. The captures exclude unfinished #430 window/pin work.
No production chat message, microphone request or account mutation was used.

## Desktop states

All desktop captures use a 1480 x 1000 viewport and reduced motion.

| Page | Normal | Maximised | Restored |
| --- | --- | --- | --- |
| Home, dark | [Normal](desktop-normal.png) | [Maximised](desktop-maximised.png) | [Restored](desktop-restored.png) |
| Usage, light | [Normal](usage-normal.png) | [Maximised](usage-maximised.png) | Same measured geometry as normal |

Measured window and composer rectangles share the same left edge and width,
with a 2 CSS-pixel tolerance and no horizontal page overflow:

| Page | Normal left / width | Maximised left / width | Restored left / width |
| --- | --- | --- | --- |
| Home | 398 / 740 px | 96 / 1344 px | 398 / 740 px |
| Usage | 398 / 740 px | 72 / 1392 px | 398 / 740 px |

Checks exercised keyboard activation of Maximise, plus Restore size, Minimise,
Close, repeated toggles, hiding while maximised and reopening. The composer
returns to its normal
width when hidden and matches the reopened window. Normal-motion desktop
interaction also passes after entrance motion settles.

Browser selector checks confirm that phone, voice, closed/minimised chat and
an unrelated maximised window do not activate the width override. The voice
check changes fixture DOM attributes only; it is not a live audio check.

## Phone

The 390 x 844 phone captures use reduced motion:
[dark](phone-dark.png) and [light](phone-light.png).

The transcript and composer remain 366 px wide at x=12 px, with no horizontal
overflow. Hiding/reopening the transcript keeps that composer width; no
Maximise control appears.

The existing glass, controls, focus indication and motion are unchanged.
Physical-phone, hardware-GPU, live voice and post-deploy acceptance are not
claimed.
