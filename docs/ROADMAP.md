# Roadmap

This roadmap describes the planned direction for `codex-gateway-mcp-server`.

The goal of this project is to provide a safer gateway layer for using Codex CLI
in real development and OSS maintenance workflows. Items already in place are
marked as done so the roadmap reflects the current state honestly.

## Phase 1: Documentation and project clarity

- [x] Add an English summary to the README
- [x] Clarify the security model ([`SECURITY.md`](./SECURITY.md))
- [x] Add an example workflow for OSS maintainers ([`../examples/oss-maintenance-workflow.md`](../examples/oss-maintenance-workflow.md))
- [x] Document recommended GitHub topics ([`MAINTAINING.md`](./MAINTAINING.md))
- [ ] Continue improving setup and usage instructions for non-Japanese readers

## Phase 2: Safety and policy coverage

- [ ] Expand tests for blocked commands (edge cases, chaining, bypass attempts)
- [ ] Add more path-policy test cases
- [ ] Strengthen protected-branch checks
- [ ] Validate configuration handling
- [ ] Improve audit-log coverage and assertions

## Phase 3: CI and maintainability

- [x] GitHub Actions running build / typecheck / lint / test on PRs (`.github/workflows/ci.yml`)
- [x] Add contribution guidelines ([`../CONTRIBUTING.md`](../CONTRIBUTING.md))
- [ ] Expand CI (e.g. Node version matrix) and document its behavior
- [ ] Add issue templates
- [ ] Add a pull request template

## Phase 4: Configurable policies

- [ ] Support configurable command policies on top of secure defaults
- [ ] Support repository-specific path policies
- [ ] Keep safer defaults when configuration is absent
- [ ] Document policy configuration examples

## Phase 5: OSS maintainer workflow support

- [ ] Add end-to-end workflow examples
- [ ] Document split-agent workflows in more depth
- [ ] Improve diff-review support
- [ ] Explore PR creation or PR preparation flows
- [ ] Add more practical examples for real repository maintenance

## Long-term vision

The long-term goal is to make Codex easier and safer to adopt in real
repositories by clearly separating planning, implementation, review, and
execution control.

This project aims to become a practical safety layer for teams and OSS
maintainers who want to use Codex as an implementation agent without giving up
control over repository boundaries, command execution, and auditability.
