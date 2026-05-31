# Contributing

Thank you for your interest in contributing to `codex-gateway-mcp-server`.

This project focuses on safe Codex CLI execution through an MCP gateway. Its
value comes from predictable, reviewable, and auditable behavior, so
contributions are evaluated with security and clarity in mind.

## Areas where contributions are welcome

- Security policy improvements
- Command-blocking tests
- Path policy tests
- Documentation (including English documentation)
- Workflow examples
- CI improvements
- MCP integration improvements

## Development guidelines

- Keep secure defaults
- Avoid broad repository access by default
- Add tests for policy changes
- Document behavior clearly
- Prefer explicit configuration over implicit behavior

## Local checks

Before opening a pull request, please run the same checks CI runs:

```bash
npm ci
npm run build
npm run typecheck
npm run lint
npm test
```

## Pull requests

Before opening a pull request, please:

- Explain the motivation
- Describe the security impact
- Add tests where applicable
- Update documentation if behavior changes

See [`docs/MAINTAINING.md`](./docs/MAINTAINING.md) for maintenance conventions
and [`docs/ROADMAP.md`](./docs/ROADMAP.md) for the planned direction of the
project.
