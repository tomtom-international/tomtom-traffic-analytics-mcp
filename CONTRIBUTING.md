# Contributing to TomTom Traffic Analytics MCP Server

Thank you for your interest in contributing! This guide will help you get started.

## Code of Conduct

This project adheres to the [TomTom Code of Conduct](https://tomtominternational.sharepoint.com/:b:/r/sites/intouch2/MyServices/codeofconduct/Documents/20190918_TT_CodeOfConduct_v6-hyperlinks.pdf?csf=1&web=1&e=j2aec3). By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

## Getting Started

### Prerequisites

- **Node.js 22+**
- Git

### Development Setup

```bash
# Clone the repository
git clone https://github.com/tomtom-international/tomtom-traffic-analytics-mcp.git
cd tomtom-traffic-analytics-mcp

# Install dependencies
npm install

# Build
npm run build

# Run unit tests (no API keys required)
npm test
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
| `npm run build` | Build TypeScript |
| `npm test` | Run unit tests with coverage |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:all` | Run unit + integration tests (requires API keys) |
| `npm run lint` | Lint source code |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run format` | Format code with Prettier |

### Code Style

- TypeScript with strict mode
- ESLint for linting
- Prettier for formatting
- Run `npm run lint` and `npm run format` before submitting

### Architecture

Every tool follows the 4-layer pattern: **Tool → Handler → Service → SQL Engine**

1. **Tools** (`src/tools/`) — Register MCP tools with name, description, schema, and handler
2. **Handlers** (`src/handlers/`) — Orchestrate validation, API calls, flattening, and SQL filtering
3. **Services** (`src/services/`) — HTTP calls to TomTom APIs
4. **SQL Layer** (`src/sql/`) — DuckDB-powered filtering with flatteners and table schemas

## Submitting Changes

### Pull Request Process

1. Fork the repository and create a feature branch from `main`
2. Make your changes, ensuring tests pass (`npm test`)
3. Run linting (`npm run lint`) and formatting (`npm run format`)
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
