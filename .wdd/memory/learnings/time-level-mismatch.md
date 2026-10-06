---
type: learning
date: "2026-10-06"
ward: core-001
tags: [simulation, discretization, capacity]
---
# Compare positions at the same time level within a tick

## What happened
The first model contract checked downstream space for a crossing vehicle using the downstream tail's **pre-move** position, while the crossing vehicle was placed at its **post-move** position. Two vehicles starting in lockstep 7.5 m apart then could not cross 4 ticks apart. Single-lane capacity silently dropped from 1800 to about 1200 veh/h. Nothing crashed. Only a quantitative test plus an independent reference implementation (Red reviewer) exposed it.

## Rule
In multi-phase ticks (discharge → admission → movement), every comparison between two vehicles must use the same time level. Use a conservative *guaranteed* post-move position (`tail_guaranteed`) when the other party has not moved yet.

## Applies to
Any later rule that compares positions across links or phases: gridlock handling, signal stop lines, rendering extrapolation sanity checks.
