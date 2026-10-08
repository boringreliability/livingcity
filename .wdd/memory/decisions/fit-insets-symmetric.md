# FIT_INSETS stay vertically symmetric (city-004)

**Decision:** `FIT_INSETS = { top: 120, right: 24, bottom: 120, left: 24 }`. Every overlay lives in the top or bottom band: the control panel at the top, and the metrics strip and the compact legend at the bottom.

**Why:**
- The planned 140/96 insets moved the fitted city's centre 22 px off the canvas centre.
- The frozen city-003 inspection tests zoom in at the canvas centre and expect the busy Main Bridge there; with the shifted centre they found no suitable vehicles. Users zoom there too.
- A right-hand legend column would have shrunk the height-limited city. A tall legend in the corner covered the south-east blocks (Gold r1 MAJOR).

**How to apply:** new overlays must fit in the 120 px bands, or the bands must grow symmetrically. Never reserve one side only.
