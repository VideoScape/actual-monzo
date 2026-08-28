# actual-monzo

Automated synchronization between Monzo bank accounts, Monzo Pots, and Actual Budget.

This is the VideoScape-maintained fork. It is developed independently and adds first-class
Monzo Pot accounts, linked Current-to-Pot transfers, linked Pot-to-Pot transfers, and one-time
Pot balance reconciliation. It can also capture complete Monzo history during the short
post-authentication access window and import that secure snapshot later.

## Features

- 🔐 **Secure OAuth Integration** - Connect to Monzo using official OAuth 2.0 flow
- 💰 **Transaction Import** - Sync Monzo transactions to Actual Budget
- 🗺️ **Account Mapping** - Configure which Monzo accounts sync to which Actual Budget accounts
- 🏺 **First-class Monzo Pots** - Create a dedicated on-budget Actual account for every open Pot
- 🔁 **Linked Transfers** - Preserve Current ↔ Pot and Pot ↔ Pot movements as Actual transfers
- ⚖️ **Pot Balance Reconciliation** - Initialize new Pot accounts to their live Monzo balance
- 🗄️ **Complete History Bootstrap** - Capture all Monzo history immediately after reauthentication
- 🏺 **Archived Pot History** - Preserve movements involving deleted Pots during a full import
- 🏷️ **Category Mapping** - Map Monzo categories during import and safely backfill historical transactions
- 💾 **Persistent Configuration** - Global config stored in `~/.actual-monzo/` with secure permissions (chmod 600)
- 🌍 **Global Installation** - Install once, run from anywhere
- 📋 **Import History** - Automatic logging of all imports in `~/.actual-monzo/logs/`

## Quick Start

### Prerequisites

1. **Monzo Developer Account**
   - Register at [Monzo Developers](https://developers.monzo.com/)
   - Create an OAuth client application
   - Set redirect URI: `http://localhost:8234/callback` (or custom port, see below)
   - Note your Client ID and Client Secret

2. **Actual Budget Server**
   - Running Actual Budget instance (local or remote)
   - Server URL (default: `http://localhost:5006`)
   - Server password

3. **Monzo Mobile App**
   - Installed on your mobile device (required to approve OAuth)

### Installation

#### Install this fork from source

```bash
git clone https://github.com/VideoScape/actual-monzo.git
cd actual-monzo
pnpm install
pnpm build
pnpm link --global

actual-monzo setup
actual-monzo map-accounts
actual-monzo map-pots
actual-monzo import
```

Do not use `npm install -g actual-monzo` if you need Pot support; that installs the upstream
package rather than this fork.

#### Local development

```bash
# Clone the repository
git clone https://github.com/VideoScape/actual-monzo.git
cd actual-monzo

# Install dependencies
pnpm install

# Build the project
pnpm build

# Run locally
node dist/index.js setup
```

### Setup

Run the setup command to configure both Monzo and Actual Budget:

```bash
actual-monzo setup
```

This will:

1. Collect your Monzo OAuth credentials (Client ID & Secret)
2. Open a browser for Monzo authorization
3. Collect your Actual Budget server details
4. Validate the connection and save to `~/.actual-monzo/config.yaml`

**Security:** The config file is automatically set to `chmod 600` (owner read/write only).

**Custom OAuth Port:** To use a different port for the OAuth callback (default: 8234):

```bash
# Set custom port and run setup
OAUTH_CALLBACK_PORT=9000 actual-monzo setup
```

Make sure your Monzo OAuth redirect URI matches: `http://localhost:{PORT}/callback`

### Map Accounts

Configure which Monzo accounts sync to which Actual Budget accounts:

```bash
actual-monzo map-accounts
```

This interactive command lets you select mappings between your Monzo accounts and Actual Budget accounts.

### Import Transactions

Import Monzo transactions into Actual Budget:

```bash
actual-monzo import
```

Options:

- `--start <date>` - Import transactions from this date (YYYY-MM-DD, default: 30 days ago)
- `--end <date>` - Import transactions until this date (YYYY-MM-DD, default: today)
- `--account <id>` - Import only this Monzo account ID
- `--dry-run` - Preview import without making changes
- `--snapshot <path>` - Import a secure snapshot created by `capture-history`
- `--keep-snapshot` - Keep a snapshot after a successful import instead of deleting it

### Capture complete Monzo history

Monzo exposes complete transaction history for only a short period immediately after interactive
authentication. Capture it before resetting or rebuilding an Actual budget:

```bash
actual-monzo capture-history
```

The command reuses the configured OAuth client, refreshes only the Monzo session credentials,
downloads every mapped account concurrently, maps open and deleted Pots, and writes a mode `0600`
snapshot. It prints the exact follow-up command:

```bash
actual-monzo import --snapshot /path/printed/by/capture-history.json
```

The snapshot is removed automatically after a successful live import. It is retained after a
failed import so the capture can be retried without another time-sensitive authentication.

### Scheduled import with systemd

The repository includes a one-shot service and timer for Docker-based installations. It runs
after boot and daily at 04:15 Europe/London with a randomized delay of up to 15 minutes.

```bash
sudo install -m 0644 deploy/systemd/actual-monzo.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/actual-monzo.timer /etc/systemd/system/
sudo install -m 0644 deploy/systemd/actual-monzo.logrotate /etc/logrotate.d/actual-monzo
sudo systemctl daemon-reload
sudo systemctl enable --now actual-monzo.timer
```

Inspect the schedule and logs with:

```bash
systemctl list-timers actual-monzo.timer
tail -n 100 /var/log/actual-monzo/import.log
```

### Map Monzo Pots

After mapping the parent bank accounts, discover every open Pot and create or reuse a dedicated
on-budget Actual account:

```bash
actual-monzo map-pots
```

For a complete-history bootstrap, include deleted Pots so their historic transfers remain linked:

```bash
actual-monzo map-pots --include-deleted
```

Run `map-pots` again after creating a new Pot in Monzo. Historical mappings are retained so an
old Pot movement is never silently converted into income or spending.

### Map and backfill categories

Map Monzo's spending categories to categories already present in Actual Budget:

```bash
actual-monzo map-categories
```

Future imports use those mappings immediately. Existing imports preserve their original Monzo
category in the transaction notes and can be categorized retroactively:

```bash
actual-monzo backfill-categories --dry-run
actual-monzo backfill-categories
```

The backfill only fills blank categories unless `--overwrite` is explicitly supplied. Pot
transfers and Monzo's generic `transfers` category are deliberately left categoryless.

## Configuration

After setup, configuration files are stored in `~/.actual-monzo/`:

```
~/.actual-monzo/
├── config.yaml          # Main configuration file
└── logs/
    └── import.log       # Import history log
```

**config.yaml** structure:

```yaml
monzo:
  clientId: 'oauth2client_...'
  clientSecret: 'mnzconf...'
  accessToken: 'access_token_...'
  refreshToken: 'refresh_token_...'
  tokenExpiresAt: '2025-10-01T18:00:00.000Z'

actualBudget:
  serverUrl: 'http://localhost:5006'
  password: 'your-password'
  dataDirectory: '/Users/you/.actual'
  validatedAt: '2025-10-01T12:05:00.000Z'

accountMappings:
  - monzoAccountId: 'acc_...'
    monzoAccountName: 'Current Account'
    actualAccountId: '...'
    actualAccountName: 'Checking'

potMappings:
  - monzoPotId: 'pot_...'
    monzoPotName: 'Bills'
    monzoAccountId: 'acc_...'
    actualAccountId: '...'
    actualAccountName: 'Monzo Pot - Bills'
    balanceInitializedAt: '2026-08-27T01:00:00.000Z'

categoryMappings:
  - monzoCategory: groceries
    actualCategoryId: '...'
    actualCategoryName: Food

setupCompletedAt: '2025-10-01T12:05:00.000Z'
```

**Security:**

- Config file is automatically set to `chmod 600` (owner read/write only)
- Stored in your home directory, isolated from project code
- The file contains Monzo OAuth credentials and the Actual server password; protect host backups too
- Never commit or share your config file

## Development

### Project Structure

```
actual-monzo/
├── src/
│   ├── commands/       # CLI commands (setup, capture-history, import, account/Pot mapping)
│   ├── services/       # Business logic (OAuth, API clients)
│   ├── types/          # TypeScript type definitions
│   └── utils/          # Utilities (config, OAuth server, browser)
├── tests/
│   ├── contract/       # Contract tests (API contracts)
│   ├── integration/    # Integration tests (end-to-end flows)
│   └── unit/           # Unit tests (individual functions)
└── specs/              # Feature specifications
```

### Tech Stack

- **Language:** TypeScript 5.2+
- **Runtime:** Node.js 18+
- **CLI Framework:** Commander.js
- **Interactive Prompts:** Inquirer.js
- **Testing:** Vitest
- **Config:** YAML (js-yaml) + Zod validation
- **APIs:** @actual-app/api, Axios (Monzo)

### Running Tests

```bash
# Run all tests
pnpm vitest run

# Watch mode
pnpm test

# With coverage
pnpm test:coverage

# Specific test suites
pnpm vitest run tests/contract/
pnpm vitest run tests/integration/
pnpm vitest run tests/unit/
```

**Test Coverage:**

- Contract tests (API contracts)
- Integration tests (end-to-end flows)
- Unit tests (individual functions)

### Building

```bash
# Production build
pnpm build

# Development mode (watch)
pnpm dev

# Type checking only
pnpm type-check

# Clean build artifacts
pnpm clean
```

### Linting & Formatting

```bash
# Run ESLint
pnpm lint

# Fix auto-fixable issues
pnpm lint:fix

# Format code
pnpm format
```

### Running Locally

When developing locally, the CLI uses `process.cwd()` for config location (via `ACTUAL_MONZO_CONFIG_DIR` environment variable set in `tests/setup.ts`).

```bash
# After building
node dist/index.js setup
node dist/index.js import

# Or with tsx (development)
pnpm tsx src/index.ts setup
```

### Testing Global Installation

```bash
# Build and link locally
pnpm build
pnpm link --global

# Then use from anywhere
actual-monzo setup
actual-monzo import

# Unlink when done testing
pnpm unlink --global
```

## Contributing

### Development Workflow

1. Create feature branch: `git checkout -b feature-name`
2. Make changes with tests
3. Run tests: `pnpm vitest run`
4. Run type checking: `pnpm type-check`
5. Run linter: `pnpm lint`
6. Build: `pnpm build`
7. Commit with conventional commits format
8. Create pull request

### Testing Standards

- Write tests for new features (contract tests define the API)
- Maintain comprehensive test coverage
- All tests must pass before merge
- Use TypeScript strict mode

### Code Style

- TypeScript strict mode enabled
- ESLint rules enforced (no `any` types)
- Prettier for formatting
- Conventional commits format

## Troubleshooting

### Command Not Found (After Global Install)

```bash
# Check if installed globally
npm list -g actual-monzo

# Reinstall if needed
npm install -g actual-monzo

# Check npm global bin path is in PATH
npm config get prefix
```

### Browser Doesn't Open (OAuth)

If running in headless environment or browser fails to open:

- The CLI displays a clickable URL
- Copy and paste into browser manually
- OAuth callback still works on localhost

### Actual Budget Connection Issues

```bash
# Verify server is running
docker ps | grep actual

# Check server is accessible
curl http://localhost:5006

# Verify correct port and URL
```

### OAuth Token Expired

Monzo tokens expire after 6 hours. If you see authentication errors:

- The CLI will auto-refresh tokens (when implemented)
- For now, re-run setup: `actual-monzo setup`

### Config File Issues

```bash
# Check config location and permissions
ls -la ~/.actual-monzo/config.yaml

# Should be: -rw------- (600)

# Fix permissions if needed
chmod 600 ~/.actual-monzo/config.yaml

# Start fresh (removes all config and logs)
rm -rf ~/.actual-monzo/
actual-monzo setup
```

### Local Development Config Location

When running locally via `node dist/index.js`, config is created in current directory for development convenience. For testing global behavior:

```bash
# Override config location temporarily
ACTUAL_MONZO_CONFIG_DIR=~/.actual-monzo node dist/index.js setup
```

## Security

- Config file stored in `~/.actual-monzo/` with `chmod 600` (owner read/write only)
- Config location isolated from project code (not in git repository)
- OAuth uses CSRF protection (state parameter)
- Localhost-only OAuth callback server
- Tokens stored in plain text (acceptable for read-only banking access)
- Environment variable `ACTUAL_MONZO_CONFIG_DIR` allows overriding config location for testing

## License

MIT

## Links

- [Monzo API Docs](https://docs.monzo.com/)
- [Actual Budget](https://actualbudget.org/)
- [Feature Specs](specs/) - Detailed specifications
- [GitHub Issues](https://github.com/VideoScape/actual-monzo/issues)

---

**Status:** Active Development
**Node Version:** >=18.0.0
**License:** MIT
