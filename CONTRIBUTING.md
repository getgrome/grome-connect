# Contributing to grome

Thanks for your interest! Contributions of all kinds are welcome — bug reports, feature requests, docs, and PRs.

## Development setup

```bash
git clone https://github.com/getgrome/grome-connect.git
cd grome-connect
npm install
npm run build
```

Link the local build for testing:

```bash
npm link
grome --help
```

## Running checks

```bash
npm run typecheck
npm test
npm run build
```

Please run all three before opening a PR.

## Pull requests

1. Fork and create a feature branch from `main`.
2. Keep changes focused — one concern per PR.
3. If you change the `.grome/` directory model, update `buildInjection()` in `src/core/AgentConfigInjector.ts` and the table in `CLAUDE.md`.
4. Add tests for new behavior when practical.
5. Update `CHANGELOG.md` under `## [Unreleased]`.

## Reporting bugs

Open an issue with:
- What you ran
- What you expected
- What happened instead
- Node version and OS

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.
