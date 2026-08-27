/**
 * Import Command
 * CLI command to import Monzo transactions into Actual Budget
 */

import { Command } from 'commander';
import ora, { type Ora } from 'ora';
import chalk from 'chalk';
import { loadConfig } from '../utils/config-manager.js';
import { parseDateRange } from '../utils/date-utils.js';
import { ImportService } from '../services/import-service.js';
import { suppressConsole } from '../utils/cli-utils.js';
import type { Config } from '../utils/config-schema.js';
import type { AccountMapping, ImportSession } from '../types/import.js';

/**
 * Import command options interface
 */
interface ImportOptions {
  start: string;
  end: string;
  account?: string;
  dryRun: boolean;
}

/**
 * Calculate default start date (30 days ago)
 */
function calculateDefaultStart(): string {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return thirtyDaysAgo.toISOString().split('T')[0];
}

/**
 * Calculate default end date (today)
 */
function calculateDefaultEnd(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Validate configuration for import command
 * Ensures all required fields are present
 *
 * @param config Configuration to validate
 * @throws Error if configuration is incomplete
 */
function validateImportConfig(config: Config): void {
  // Check Monzo configuration
  if (!config.monzo?.clientId || !config.monzo?.clientSecret) {
    throw new Error(
      'Monzo configuration missing. Please run setup command:\n' + '  actual-monzo setup'
    );
  }

  // Check Actual Budget configuration
  if (!config.actualBudget?.serverUrl || !config.actualBudget?.password) {
    throw new Error(
      'Actual Budget configuration missing. Please run setup command:\n' + '  actual-monzo setup'
    );
  }

  // Check account mappings exist
  if (!config.accountMappings || config.accountMappings.length === 0) {
    throw new Error(
      'No account mappings configured. Please run setup command:\n' + '  actual-monzo setup'
    );
  }

  // Check access token
  if (!config.monzo?.accessToken) {
    throw new Error(
      'Monzo access token missing or expired. Please run setup command:\n' + '  actual-monzo setup'
    );
  }
}

/**
 * Filter account mappings by account ID if specified
 *
 * @param mappings All account mappings
 * @param accountId Optional account ID filter
 * @returns Filtered account mappings
 * @throws Error if specified account not found
 */
function filterAccountMappings(mappings: AccountMapping[], accountId?: string): AccountMapping[] {
  if (!accountId) {
    return mappings;
  }

  const filtered = mappings.filter(m => m.monzoAccountId === accountId);

  if (filtered.length === 0) {
    throw new Error(
      `Account ${accountId} not found in mappings.\n` +
        `Available accounts:\n` +
        mappings.map(m => `  - ${m.monzoAccountId}: ${m.monzoAccountName}`).join('\n')
    );
  }

  return filtered;
}

/**
 * Display import summary after completion
 *
 * @param session Completed import session
 * @param mappings Account mappings used
 * @param dryRun Whether this was a dry run
 */
function displayImportSummary(
  session: ImportSession,
  mappings: AccountMapping[],
  dryRun: boolean
): void {
  const duration = ((Date.now() - session.startTime.getTime()) / 1000).toFixed(1);

  console.log(chalk.green(`\n✓ ${dryRun ? 'Preview' : 'Import'} completed in ${duration}s\n`));

  console.log(
    `Accounts: ${session.successfulAccounts.length}/${session.accountsProcessed} processed`
  );

  // Display successful accounts
  session.successfulAccounts.forEach(accountId => {
    const mapping = mappings.find(m => m.monzoAccountId === accountId);
    if (mapping) {
      console.log(chalk.green(`  ✓ ${mapping.monzoAccountName}`));
    }
  });

  // Display failed accounts
  if (session.failedAccounts.length > 0) {
    console.log(chalk.yellow(`\nFailed: ${session.failedAccounts.length} account(s)`));
    session.failedAccounts.forEach(failure => {
      console.log(chalk.red(`  ✗ ${failure.accountName}: ${failure.message}`));
    });
  }

  // Display statistics
  const verb = dryRun ? 'Would import' : 'Imported';
  console.log(`\n${verb}: ${session.totalTransactions} transaction(s)`);
  if (session.declinedFiltered > 0) {
    console.log(`Filtered: ${session.declinedFiltered} declined transaction(s)`);
  }
  if (session.potTransfers > 0) {
    console.log(`Pot transfers: ${session.potTransfers} (${session.potToPotTransfers} Pot-to-Pot)`);
  }
  if (session.potTransfersSkipped > 0) {
    console.log(
      chalk.yellow(
        `Skipped: ${session.potTransfersSkipped} unmapped Pot movement(s); run actual-monzo map-pots`
      )
    );
  }
  if (session.potBalancesInitialized > 0) {
    console.log(`Pot balances reconciled: ${session.potBalancesInitialized} account(s)`);
  }
  if (session.potBalancesPending > 0) {
    console.log(`Pot balances to reconcile on import: ${session.potBalancesPending} account(s)`);
  }
}

/**
 * Import command action handler
 */
async function importAction(options: ImportOptions): Promise<void> {
  let spinner: Ora | undefined;

  try {
    // Load configuration
    const config = await loadConfig();

    // Validate configuration
    validateImportConfig(config);

    // Parse and validate date range
    const dateRange = parseDateRange(options.start, options.end);

    // Filter account mappings if --account specified
    const accountMappings = filterAccountMappings(config.accountMappings!, options.account);

    // Initialize import service
    const importService = new ImportService();

    // Start spinner
    const verb = options.dryRun ? 'Previewing' : 'Importing';
    spinner = ora(`${verb} transactions...`).start();

    // Execute import with console suppression for Actual SDK background sync
    const session = await suppressConsole(async () => {
      return await importService.executeImport(
        config,
        accountMappings,
        dateRange,
        options.dryRun,
        spinner
      );
    });

    // Stop spinner
    spinner.succeed(`${verb} complete`);

    // Display summary
    displayImportSummary(session, accountMappings, options.dryRun);

    process.exit(0);
  } catch (error) {
    if (spinner) {
      spinner.fail();
    }

    console.error(
      chalk.red(`\nImport failed: ${error instanceof Error ? error.message : String(error)}`)
    );

    process.exit(1);
  }
}

/**
 * Create and configure import command
 */
export const importCommand = new Command('import')
  .description('Import Monzo transactions into Actual Budget')
  .option('-s, --start <date>', 'Start date (YYYY-MM-DD)', calculateDefaultStart())
  .option('-e, --end <date>', 'End date (YYYY-MM-DD)', calculateDefaultEnd())
  .option('-a, --account <id>', 'Import specific Monzo account ID')
  .option('--dry-run', 'Preview import without making changes', false)
  .action(importAction);
