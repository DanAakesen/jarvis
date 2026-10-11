# Orb and Folio polish

Dan requested brighter orange ring inlays and dismissal of the Folio when he
selects another page, including a page that has no sidebar.

These are local Chromium captures from the real Vite app, using software WebGL.
Authentication, Folio entries and Usage values are intercepted fixtures, not
Dan's account data or production measurements. The Folio captures demonstrate
panel visibility, not live API acceptance.

## Orb comparison

The matched reduced-motion captures use 1440 x 1000 desktop and 390 x 844 phone
viewports. The before capture restores the previous inlay material and geometry
in the served scene module; the after capture uses the changed source. Other
scene geometry, palette and floor rendering are unchanged.

| Viewport | Before | After |
| --- | --- | --- |
| Desktop | [Before](desktop-orb-before.png) | [After](desktop-orb-after.png) |
| Phone | [Before](phone-orb-before.png) | [After](phone-orb-after.png) |

The rear inlays bypass fog and tone mapping and retain their warm colour with a
slightly wider fine line. Motion is unchanged.

## Folio navigation

| Viewport | Folio open | After selecting Usage |
| --- | --- | --- |
| Desktop | [Open](desktop-folio-open.png) | [Closed](desktop-folio-closed.png) |
| Phone | [Open](phone-folio-open.png) | [Closed](phone-folio-closed.png) |

Automated browser interaction checked keyboard selection on desktop and touch
menu selection on phone, in light and dark themes. Selecting Usage twice,
home/Jarvis, and Settings dismisses the Folio and clears the left panel. The
phone menu also closes. Reduced-motion phone coverage retained the same result.
Normal-motion captures were inspected after the panel settled.

Component regressions cover desktop links, same-page selection, phone links,
Jarvis navigation through workspace SSE, focus leaving the hidden Folio, and
back/forward history without reopening the pane.

The signed-in shared local canvas also showed Folio closing after Usage was
clicked. Its Usage API subsequently requested renewed Microsoft sign-in; no
messages or mutations were sent to compensate. Physical-phone, hardware-GPU and
post-deploy acceptance are not claimed.
