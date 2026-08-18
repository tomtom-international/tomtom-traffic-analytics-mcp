# Contributing to TomTom Traffic Analytics MCP Server

Thank you for your interest in contributing! This guide will help you get started.

## Code of Conduct

This project adheres to the [TomTom Code of Conduct](https://tomtominternational.sharepoint.com/:b:/r/sites/intouch2/MyServices/codeofconduct/Documents/20190918_TT_CodeOfConduct_v6-hyperlinks.pdf?csf=1&web=1&e=j2aec3). By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

## Getting Started

### Prerequisites

- **Node.js 22.12+**
- Git

### Development Setup

This project uses [pnpm](https://pnpm.io) (`>=11`) as its package manager — install it with
`npm install -g pnpm` or `corepack enable`. Linting and formatting are handled by
[Biome](https://biomejs.dev), which replaces the former ESLint + Prettier setup.

```bash
# Clone the repository
git clone https://github.com/tomtom-international/tomtom-traffic-analytics-mcp.git
cd tomtom-traffic-analytics-mcp

# Install dependencies
pnpm install

# Build
pnpm run build

# Run unit tests (no API keys required)
pnpm test
```

### Environment Variables

Copy `.env.example` to `.env` and fill in your API keys if you need to run integration tests:

```bash
cp .env.example .env
```

## Development Workflow

### Commands

| Command | Description |
|---------|-------------|
| `pnpm run build` | Build TypeScript |
| `pnpm test` | Run unit tests with coverage |
| `pnpm run test:watch` | Run tests in watch mode |
| `pnpm run test:all` | Run unit + integration tests (requires API keys) |
| `pnpm type-check` | Type-check without emitting output |
| `pnpm lint` | Lint `src/`, `scripts/`, `tests/` and root scripts (Biome) |
| `pnpm lint:fix` | Auto-fix lint issues |
| `pnpm format` | Check formatting |
| `pnpm format:fix` | Apply formatting |
| `pnpm check` / `pnpm check:fix` | Lint + format in one pass |
| `pnpm run build:mcpb` | Build the MCPB bundle for the current platform |
| `pnpm run verify:mcpb` | Unpack that bundle and smoke-test it over stdio |

### Code Style

- TypeScript with strict mode
- [Biome](https://biomejs.dev) for both linting and formatting — configured in `biome.json`
- Run `pnpm lint` and `pnpm format` before submitting; both are enforced in CI, alongside
  `pnpm type-check`
- Biome covers `src/`, `scripts/`, `tests/` and the root config scripts. JSON is deliberately
  out of scope: `prepare-release.yml` rewrites `package.json` and `manifest-binary.json` with `yq`,
  whose output would then fail `pnpm format` on the next PR. Note that `tsconfig.json` still
  only type-checks `src/`, so `scripts/` and `tests/` get lint and formatting but no types
- Biome reports a number of `warn`-level findings (`noExplicitAny`, `useImportType`,
  `noNonNullAssertion`, cognitive complexity). These do not fail the build; fix the ones your
  change touches rather than reformatting or rewriting untouched files in a feature PR

### Architecture

Every tool follows the 4-layer pattern: **Tool → Handler → Service → SQL Engine**

1. **Tools** (`src/tools/`) — Register MCP tools with name, description, schema, and handler
2. **Handlers** (`src/handlers/`) — Orchestrate validation, API calls, flattening, and SQL filtering
3. **Services** (`src/services/`) — HTTP calls to TomTom APIs
4. **SQL Layer** (`src/sql/`) — DuckDB-powered filtering with flatteners and table schemas

## Submitting Changes

### Pull Request Process

1. Fork the repository and create a feature branch from `main`
2. Make your changes, ensuring tests pass (`pnpm test`)
3. Run linting (`pnpm lint`) and formatting (`pnpm format`)
4. Submit a pull request with a clear description of the changes

### Commit Messages

- Use clear, descriptive commit messages
- Reference issue numbers where applicable (e.g., `Fixes #42`)

### Developer Certificate of Origin (DCO)

All contributions must be signed-off according to the Developer Certificate of Origin (DCO). This attests that you have the right to contribute the code you are submitting.

To sign-off your commits, add the `--signoff` option to your git commit command:

```bash
git commit --signoff -m "Your detailed commit message"
```

Or use the shorthand:

```bash
git commit -s -m "Your detailed commit message"
```

## Reporting Issues

- Use [GitHub Issues](https://github.com/tomtom-international/tomtom-traffic-analytics-mcp/issues) to report bugs or request features
- Include steps to reproduce for bug reports
- For security vulnerabilities, please refer to our organization's [security policy](https://github.com/tomtom-international/.github/blob/main/SECURITY.md)

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE.md).
