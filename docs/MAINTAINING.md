# Maintaining

This document collects maintenance notes for `codex-gateway-mcp-server`: how the
project is kept healthy, what conventions contributors should follow, and the
repository settings that cannot be expressed in code (such as GitHub topics).

## Recommended GitHub Topics

GitHub topics improve discoverability for people searching for Codex, MCP, and
OSS maintenance tooling. They must be configured from the repository page
(**Settings → General**, or the gear icon next to **About** on the repo home),
because they are repository metadata rather than files in the tree.

The following topics are recommended for this repository:

- codex
- mcp
- codex-cli
- ai-agent
- openai
- developer-tools
- oss-maintenance
- security

## Continuous integration

CI runs through GitHub Actions (`.github/workflows/ci.yml`) on every push to
`main`, on every pull request, and via manual `workflow_dispatch`. The workflow
performs, in order:

1. `npm ci` — install dependencies
2. `npm run build` — compile with `tsc`
3. `npm run typecheck` — type-only check (`tsc --noEmit`)
4. `npm run lint` — ESLint
5. `npm test` — path-guard and codex-exec smoke tests

The workflow supports hybrid runner routing: when the repository variable
`RUNNER_LABELS` is set it targets a self-hosted runner, otherwise it falls back
to `ubuntu-latest`.

## Release and versioning

- The package version lives in `package.json` (`version`).
- This project is published as an MCP server entrypoint (`dist/index.js`); run
  `npm run build` before tagging a release so `dist/` reflects the source.
- Use semantic versioning. Bump the patch version for fixes, the minor version
  for backward-compatible features, and the major version for breaking changes
  to tool schemas or default security policy.

## Security policy changes

Security defaults are deliberately strict (see [`SECURITY.md`](./SECURITY.md)).
When changing anything in `src/core/policy.ts`, `src/core/pathGuard.ts`, or the
command-blocking logic:

- Keep secure defaults; never widen access silently.
- Add or update tests under `tests/` for the changed behavior.
- Document the change in `SECURITY.md` and the PR description.

## Issue and contribution flow

- Open issues for non-trivial changes before sending a PR.
- See [`../CONTRIBUTING.md`](../CONTRIBUTING.md) for contribution guidelines.
- The planned direction of the project is tracked in [`ROADMAP.md`](./ROADMAP.md).
