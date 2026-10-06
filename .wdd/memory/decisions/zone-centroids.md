---
type: decision
date: "2026-10-06"
ward: core-001
tags: [network, demand, fairness]
---
# Trips start and end at zone centroids; no route passes through a zone

## Decision
Trip origins are zone nodes (`NetworkBuilder::zone`) or source nodes without in-links. Routes may not pass through a zone. Zones connect to the street network with connector links.

## Rationale
The core-001 Red review (r6) showed that origin admission at a junction with through traffic starves the through traffic completely. An origin vehicle entering at rest needs `tail_guaranteed ≥ 7.5`, while a moving front needs `entry_s + 7.5 > 7.5`, so the origin always wins the space. Centroid connectors (standard in transport modeling) move the competition into normal round-robin discharge, which is fair by construction.

## Consequences
- The city (epic `city`) models districts/workplaces/hospital as zones with connector links.
- The router (core-002) must not relax edges through zone nodes.
- Spawn validation: `OriginHasThroughTraffic`, `RouteThroughZone`.
