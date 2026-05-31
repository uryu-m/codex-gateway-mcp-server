# Issue Drafts

This file tracks the seed issues used to plan OSS maintenance work for
`codex-gateway-mcp-server`. It doubles as a copy-paste source if an issue needs
to be re-created.

## Filed issues

| #                                                                   | Title                                                  | Labels                              | Status |
| ------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------- | ------ |
| [#10](https://github.com/uryu-m/codex-gateway-mcp-server/issues/10) | Add more policy tests for blocked commands             | `enhancement`, `help wanted`        | open   |
| [#11](https://github.com/uryu-m/codex-gateway-mcp-server/issues/11) | Expand and document the CI workflow                    | `enhancement`                       | open   |
| [#12](https://github.com/uryu-m/codex-gateway-mcp-server/issues/12) | Expand English documentation beyond the README summary | `documentation`, `good first issue` | open   |
| [#13](https://github.com/uryu-m/codex-gateway-mcp-server/issues/13) | Support configurable command policy                    | `enhancement`                       | open   |

Notes on framing:

- The original "Add CI workflow for smoke tests" idea was filed as **#11
  (Expand and document the CI workflow)** because a CI workflow already exists
  (`.github/workflows/ci.yml`); the open work is making it more robust and
  documenting it.
- The original "Add English documentation" idea was filed as **#12**, which now
  builds on the English summary already added to the README.

## Not filed (delivered or ready to file)

### Add an OSS-maintenance workflow example

The initial end-to-end example is **already included** in this repository at
[`examples/oss-maintenance-workflow.md`](../examples/oss-maintenance-workflow.md),
so a separate "please add it" issue was intentionally not filed.

If you want to track **additional** examples, the following draft can be filed
manually:

> **Title:** Add more practical OSS-maintenance workflow examples
>
> **Labels:** `documentation`
>
> ## Summary
>
> Add more practical OSS-maintenance workflow examples.
>
> ## Background
>
> An initial end-to-end example exists (`examples/oss-maintenance-workflow.md`).
> The value of this project is easier to understand when shown through several
> concrete scenarios, not only one.
>
> ## Proposed additional scenarios
>
> - A multi-file feature implemented within a tight `allowed_paths` scope
> - Parallel independent tasks via `codex_parallel_tasks` + worktree cleanup
> - A review-fix loop using `codex_inspect_diff` + `codex_review_fix`
> - A case where the gateway blocks an unsafe command, and how to recover
>
> ## Tasks
>
> - Add additional example documents under `examples/`
> - For each, explain which parts are handled by the human, Claude Code, Codex,
>   and the gateway
> - Include safety checkpoints
>
> ## Goal
>
> Help OSS maintainers understand how to adopt this gateway across a range of
> real workflows.
