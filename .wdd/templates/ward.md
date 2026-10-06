---
ward: 0
revision: null
name: ""
epic: ""
status: planned
dependencies: []
layer: typescript
estimated_tests: 0
created: ""
completed: null
---
# Ward {NNN}: {Name}

## Scope
{One paragraph: what this Ward builds and why}

## Inputs
{What this Ward reads/uses from previous Wards}

## Outputs
{What this Ward produces for future Wards}

## Specification
{Detailed technical spec}

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | {test_name} | {what it proves} |

## Must NOT
- {Explicit constraint}

## Must DO
- {Explicit requirement}

## Manual Smoke Test
### Setup
{Exact commands to spin up — npm link, dev server, build, etc.}

### Steps
1. Run: `{exact command}`
   Expected: `{exact output or behavior}`
2. Run: `{next command}`
   Verify: `{what to look for}`

### Pass criteria
- [ ] {concrete observable thing}
- [ ] {concrete observable thing}

## Verification
{How to prove this Ward is complete}
