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
| [#15](https://github.com/uryu-m/codex-gateway-mcp-server/issues/15) | Add more practical OSS-maintenance workflow examples   | `documentation`                     | open   |

Notes on framing:

- The original "Add CI workflow for smoke tests" idea was filed as **#11
  (Expand and document the CI workflow)** because a CI workflow already exists
  (`.github/workflows/ci.yml`); the open work is making it more robust and
  documenting it.
- The original "Add English documentation" idea was filed as **#12**, which now
  builds on the English summary already added to the README.

## Notes on the workflow example

The original "Add an example workflow for OSS maintainers" deliverable is
**included in this repository** at
[`examples/oss-maintenance-workflow.md`](../examples/oss-maintenance-workflow.md),
so it was shipped directly rather than tracked as a "please add it" issue.
Follow-up work to add **more** scenarios (multi-file scope, parallel tasks,
review-fix loops, blocked-command recovery) is tracked in #15.
