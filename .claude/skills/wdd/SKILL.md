---
name: wdd
description: "Ward-Driven Development: get project context and orient yourself. Use at session start or when you need to understand project state."
---

# WDD — Session Context

You are working on **my-project**, a project managed with Ward-Driven Development (WDD).
All project state lives in the `.wdd/` directory as markdown files with YAML frontmatter.

## Ward Lifecycle — Checkpoint Discipline

Every Ward follows this exact sequence. **You MUST STOP at each checkpoint.**

```
planned → red (write tests)
    ⏸️ STOP — Present tests to human. Wait for "approved".
    NEVER proceed without explicit human approval.

red → approved → gold (implement until tests pass)
    ⏸️ STOP — Present implementation to human. Wait for "approved"/"godkendt".
    NEVER proceed without explicit human approval.

gold → complete (via wdd complete)
```

**Rules:**
- NEVER skip from Red to Gold without human approving the tests
- NEVER skip from Gold to Complete without human approving the implementation
- NEVER start the next Ward before the current one is approved as complete
- If tests fail during Gold, fix them — do NOT change the test expectations

## CLI Commands

| Command | Purpose |
|---------|---------|
| `wdd session` | Get full project context (start here) |
| `wdd status` | Show progress dashboard |
| `wdd ward create "Name" --epic <slug>` | Create a new Ward |
| `wdd ward status <id> <status>` | Update Ward status |
| `wdd complete <id>` | Complete a Ward (snapshot + progress) |
| `wdd validate` | Check structural integrity |
| `wdd progress` | Regenerate PROGRESS.md |
| `wdd ward reopen <id> --reason "text"` | Reopen a completed Ward |
| `wdd epic create "Name" --slug <slug>` | Create a new Epic |
| `wdd search <query> [--tag <tag>]` | Search project memory |
| `wdd bootstrap claude\|cursor` | Install AI adapter |
| `wdd init --name "project"` | Initialize WDD in a new project |
| `wdd api [--file <pattern>] [--kind <function\|interface\|type\|const\|class>]` | List exports from src/ — check this before writing new utilities to avoid reinvention |
| `wdd configure [--write]` | Detect repo scan paths/extensions (for non-TS or non-`src/` projects). Run with `--write` to apply detected config |
| `wdd upgrade [--dry-run]` | Migrate `.wdd/` schema to current version |

## Manual Smoke Test Protocol (MANDATORY before Gold approval)

Automated tests prove functions work in isolation. Manual smoke tests prove a human
can use the result. Before requesting Gold-phase approval from the human, you MUST:

1. Read the `## Manual Smoke Test` section from the active ward file
2. Spin up the solution as the **Setup** subsection describes (build, npm link, dev server, etc.)
3. Provide the exact **Steps** as copy-pasteable commands to the human
4. Wait for the human to run them and report results
5. Only after they confirm the smoke test passed may you ask for Gold approval

Do not claim Gold complete based on automated tests alone. The human must have *used* the thing.

## After Completing a Ward

1. Run `wdd complete <id>` — it will snapshot CONTEXT.md and regenerate PROGRESS.md
2. Follow the commit reminder in the output
3. Update CONTEXT.md: "Current State" and "What Comes Next"
4. Run `wdd validate` to check CONTEXT.md size limits

## File Protocol

- `.wdd/epics/<slug>.md` — Epic specs; epics are slug-named, not globally numbered
- `.wdd/wards/<epic-slug>/ward-NNN.md` — Ward specs; canonical IDs are `<epic-slug>-NNN`, e.g. `drive-polish-001`
- `.wdd/CONTEXT.md` — Living document, updated after each Ward (max 200 lines)
- `.wdd/PROJECT.md` — Project identity and principles (rarely changes)
- `.wdd/PROGRESS.md` — Auto-generated, never hand-edit
- `.wdd/memory/` — Decisions, learnings, snapshots


## What To Do

1. Run `wdd session` and read the full output carefully
2. Run `wdd validate` to check project health
3. Summarize for the user:
   - Current state of the project
   - Which Ward is active and its status
   - Any blockers or warnings from validate
4. Ask the user what they want to work on
