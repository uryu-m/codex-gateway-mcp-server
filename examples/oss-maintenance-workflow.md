# OSS Maintenance Workflow Example

This document shows how an OSS maintainer can use `codex-gateway-mcp-server` to
delegate scoped implementation work to Codex while keeping review and safety
controls in place.

## Scenario

A maintainer wants to fix a small bug or add a small feature in an OSS
repository. The maintainer does not want Codex to freely modify the entire
repository. Instead, Codex should only work within specific paths, avoid
dangerous commands, and produce a reviewable diff.

## Roles

### Human maintainer

- Chooses the issue
- Defines the expected behavior
- Reviews the final diff
- Approves or rejects the change

### Claude Code or planning agent

- Reads the issue
- Creates an implementation plan
- Identifies affected files
- Defines the scope (`allowed_paths` / `forbidden_paths`) for Codex

### Codex

- Performs the scoped implementation
- Updates code within allowed paths
- Does not make final decisions without review

### codex-gateway-mcp-server

- Enforces allowed and forbidden paths
- Blocks dangerous commands
- Prevents execution on protected branches
- Runs lint, typecheck, and tests
- Stores audit logs
- Provides diff output for review

## Example flow

1. An issue is selected by the maintainer.
2. Claude Code or the maintainer creates a short implementation plan.
3. The plan is converted into a scoped Codex task.
4. The MCP gateway checks repository state and branch safety.
5. Codex runs only within the configured policy boundaries.
6. The gateway blocks unsafe commands if detected.
7. The generated diff is reviewed.
8. Lint, typecheck, and tests are executed.
9. The maintainer decides whether to create or update a pull request.

### Concretely, in Claude Code

A maintainer might phrase the delegation like this:

```
Break this issue into an implementation plan.
You (Claude Code) make the design decisions; hand only the implementation to
codex_implement.

Allowed paths for Codex:
- src/features/parser/

Forbidden:
- package.json
- .env
- migrations/

After implementation, run:
- npm run lint
- npm run typecheck
- npm test

When Codex finishes, read git diff and review before anything is committed.
```

The gateway then enforces the path and command policy, runs the checks, and
returns a structured result that Claude Code (and the human) can review.

## Safety checkpoints

Before Codex runs:

- Confirm the current branch is not protected
- Confirm allowed paths are configured
- Confirm forbidden paths are configured
- Confirm command policy is active

After Codex runs:

- Review the Git diff
- Check audit logs
- Run tests
- Confirm no unexpected files changed
- Confirm the implementation matches the original issue

## Why this workflow matters

AI agents can reduce maintenance workload, but they should not remove human
control.

This workflow keeps Codex focused on implementation while preserving human
review, repository boundaries, and traceability.
