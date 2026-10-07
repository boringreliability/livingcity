# River City calibration (city-002)

**Date:** 2026-10-07. The decision was made during city-002 Red, from a calibration prototype written in scratch.

## Layout that works
- **Grid:** 6 columns per bank: west x = −3000, −2300, −1600, −900, −500, −200; east is the mirror image. 7 rows: y = −1800 … 1800 in steps of 600.
- **Near-river column:** the column 300 m from the river (x = ±500) makes the bridge approaches short street blocks. Spillback then shows with a moderate overload, which leaves the Main Bridge spare capacity, so the city recovers after a reopen.
- **Arterials (2 lanes, 13.9 m/s):** rows y = −1200, 0, 1200, west columns x = −2300 and −900, and east columns x = 900 and 2300. All other streets are 1 lane at 11.1 m/s.
- **Bridges:**
  - Main: y = 0, 2 lanes, arterial speed.
  - North: y = 1800, 1 lane, 11.1 m/s.
  - Old: y = −1800, 1 lane, 8.3 m/s, sat flow 0.25.
- **Districts:** 11 districts and 22 zones. Each zone sits 140 m off a junction on a 2-lane connector.
  - West residential: Westbrook, Hillside, Old Town, Riverside, Millbrook.
  - West workplace: Market.
  - East workplaces: Downtown, Tech Park, Harbor.
  - East hospital: St. Mary's.
  - East residential: Eastgate.
- **Demand:** district-to-district rates, split evenly over zone pairs. The cross-river flows are scaled by 0.9 and the intra-bank flows by 2.3. West→east is about 3,000 veh/h, against Main 3,600 and North + Old 2,700.

## Why
- **Cross-river demand** must exceed the alternatives' 2,700 veh/h, so that closing the Main Bridge oversaturates them. It must also stay well under the Main Bridge's 3,600 veh/h, so the backlog clears after a reopen.
- **Intra-bank demand** carries most of the ≈ 2,000 active vehicles.
- **The plateau:** intra 2.25–2.35 × cross 0.88–0.95 passes all city-002 tests. The setting 2.3 / 0.9 is its centre.

## Measured (prototype, 8 seed pairs)
| Measure | Range |
|---|---|
| Baseline active | 1,700–1,900 |
| Closure queued / baseline | 2.8–4.4 |
| Active 20–30 min after reopen / baseline | 0.97–1.08 |
| Main Bridge share after reopen | 0.73–0.81 |
| Queued after reopen / during closure | 0.17–0.63 |

## Contract change made with this
The C3 reopen target changed from "queued ≤ 1.5 × baseline over 5 min" to backlog, share and queue-reduction criteria. The 5-min queued ratio is noise, because route choice oscillates after a reopen: it swung 1.4–3.0 with ±2 % demand.
