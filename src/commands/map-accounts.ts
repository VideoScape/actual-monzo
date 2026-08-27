/**
 * Map Accounts Command
 * CLI command to configure account mappings between Monzo and Actual Budget
 * Can be run standalone or integrated into setup flow
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { loadConfig, saveConfig } from '../utils/config-manager.js';
import { MonzoApiClient } from '../services/monzo-api-client.js';
import { suppressConsole } from '../utils/cli-utils.js';
import * as actualApi from '@actual-app/api';
import * as path from 'path';
import { checkServerCompatibility } from '../utils/actual-version-check.js';
import type { AccountMapping } from '../types/import.js';
import type { Config } from '../utils/config-schema.js';
import type { MonzoAccount } from '../types/monzo.js';
import { getMonzoAccountDisplayName } from '../utils/account-names.js';

interface ActualAccount {
  id: string;
  name: string;
  closed?: boolean;
}

interface ActualAccountResult {
  accounts: ActualAccount[];
  budgetId: string;
}

/**
 * Fetch Monzo accounts using access token
 */
async function fetchMonzoAccounts(accessToken: string): Promise<MonzoAccount[]> {
  const monzoClient = new MonzoApiClient();
  return await monzoClient.getAccounts(accessToken);
}

/**
 * Fetch Actual Budget accounts
 */
async function fetchActualAccounts(config: Config): Promise<ActualAccountResult> {
  let initialized = false;
  let budgetOpened = false;

  try {
    // Resolve data directory path (expand ~ and relative paths)
    let dataDir = config.actualBudget.dataDirectory;
    if (dataDir.startsWith('~')) {
      dataDir = dataDir.replace('~', process.env.HOME ?? '');
    } else if (dataDir.startsWith('.')) {
      dataDir = path.resolve(process.cwd(), dataDir);
    }

    // Pre-flight version compatibility check
    const versionCheck = await checkServerCompatibility(config.actualBudget.serverUrl);
    if (!versionCheck.compatible) {
      throw new Error(versionCheck.message);
    }

    // Initialize Actual Budget with suppressed console output
    const uniqueBudgets = await suppressConsole(async () => {
      await actualApi.init({
        serverURL: config.actualBudget.serverUrl,
        password: config.actualBudget.password,
        dataDir: dataDir,
      });

      // Get available budgets
      const budgets = await actualApi.getBudgets();

      if (!budgets || budgets.length === 0) {
        throw new Error('No budgets found on Actual Budget server');
      }

      // Deduplicate budgets by groupId (API sometimes returns duplicates)
      return Array.from(new Map(budgets.map(b => [b.groupId, b])).values());
    });

    initialized = true;

    // Use the first budget (or prompt user if multiple)
    let budgetId =
      uniqueBudgets.find(budget => budget.groupId === config.actualBudget.budgetId)?.groupId ??
      uniqueBudgets[0].groupId;

    if (uniqueBudgets.length > 1 && !config.actualBudget.budgetId) {
      const budgetChoices = uniqueBudgets.map(b => ({
        name: `${b.name} (${b.groupId})`,
        value: b.groupId,
        short: b.name,
      }));

      const { selectedBudgetId } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedBudgetId',
          message: 'Which budget do you want to use?',
          choices: budgetChoices,
        },
      ]);

      budgetId = selectedBudgetId;
    }

    // Download budget and get accounts with suppressed console output
    const accounts = await suppressConsole(async () => {
      await actualApi.downloadBudget(budgetId);
      budgetOpened = true;
      return await actualApi.getAccounts();
    });

    return { accounts, budgetId };
  } catch (error) {
    let errorMessage = 'Unknown error';

    if (error instanceof Error) {
      errorMessage = error.message || error.toString();
    } else if (typeof error === 'string') {
      errorMessage = error;
    } else if (typeof error === 'object' && error !== null) {
      // Actual Budget API sometimes throws plain objects like { reason: '...', meta: {...} }
      errorMessage = JSON.stringify(error, null, 2);
    } else {
      errorMessage = String(error);
    }

    throw new Error(
      `Failed to fetch Actual Budget accounts: ${errorMessage}\n` +
        `Server: ${config.actualBudget.serverUrl}\n` +
        `Data directory: ${config.actualBudget.dataDirectory}`
    );
  } finally {
    // Only call shutdown if a budget was successfully opened,
    // otherwise _fullSync crashes trying to sync a non-existent budget
    if (initialized && budgetOpened) {
      try {
        if (typeof actualApi.shutdown === 'function') {
          await actualApi.shutdown();
        }
      } catch (e) {
        // Ignore shutdown errors
      }
    }
  }
}

/**
 * Interactive account mapping flow
 * Can be called from setup command or standalone
 */
export async function runAccountMappingFlow(config: Config): Promise<Config> {
  console.log(chalk.bold('\n💰 Account Mapping\n'));
  console.log(chalk.dim('Map your Monzo accounts to Actual Budget accounts.\n'));

  // Fetch accounts from both services
  console.log(chalk.cyan('Fetching Monzo accounts...'));
  const monzoAccounts = (await fetchMonzoAccounts(config.monzo.accessToken!)).filter(
    account => !account.closed
  );

  if (monzoAccounts.length === 0) {
    throw new Error('No Monzo accounts found. Please check your Monzo configuration.');
  }

  console.log(chalk.cyan('Fetching Actual Budget accounts...'));
  const actualResult = await fetchActualAccounts(config);
  const actualAccounts = actualResult.accounts.filter(account => !account.closed);
  config.actualBudget.budgetId = actualResult.budgetId;

  if (actualAccounts.length === 0) {
    throw new Error('No Actual Budget accounts found. Please check your Actual Budget setup.');
  }

  console.log(
    chalk.green(
      `\n✓ Found ${monzoAccounts.length} Monzo account(s) and ${actualAccounts.length} Actual Budget account(s)\n`
    )
  );

  // Build account mappings interactively
  const mappings: AccountMapping[] = [];

  for (const monzoAccount of monzoAccounts) {
    const displayName = getMonzoAccountDisplayName(monzoAccount);
    console.log(chalk.bold(`\nMonzo Account: ${chalk.cyan(displayName)} (${monzoAccount.id})`));

    const { shouldMap } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'shouldMap',
        message: 'Do you want to map this Monzo account?',
        default: true,
      },
    ]);

    if (!shouldMap) {
      continue;
    }

    const actualChoices = actualAccounts.map(acc => ({
      name: `${acc.name} (${acc.id})`,
      value: acc.id,
      short: acc.name,
    }));

    const { actualAccountId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'actualAccountId',
        message: 'Which Actual Budget account should this map to?',
        choices: actualChoices,
      },
    ]);

    const actualAccount = actualAccounts.find(acc => acc.id === actualAccountId);

    if (actualAccount) {
      mappings.push({
        monzoAccountId: monzoAccount.id,
        monzoAccountName: displayName,
        actualAccountId: actualAccount.id,
        actualAccountName: actualAccount.name,
      });

      console.log(chalk.green(`  ✓ Mapped ${displayName} → ${actualAccount.name}`));
    }
  }

  if (mappings.length === 0) {
    throw new Error('No account mappings created. At least one mapping is required.');
  }

  // Update config with mappings
  config.accountMappings = mappings;

  console.log(chalk.green(`\n✓ Created ${mappings.length} account mapping(s)`));

  return config;
}

/**
 * Standalone map-accounts command
 */
async function mapAccountsAction(): Promise<void> {
  try {
    // Load existing config
    const config = await loadConfig();

    // Validate required configuration
    if (!config.monzo?.accessToken) {
      throw new Error(
        'Monzo configuration missing. Please run setup command first:\n' + '  actual-monzo setup'
      );
    }

    if (!config.actualBudget?.serverUrl || !config.actualBudget?.password) {
      throw new Error(
        'Actual Budget configuration missing. Please run setup command first:\n' +
          '  actual-monzo setup'
      );
    }

    // Check if mappings already exist
    if (config.accountMappings && config.accountMappings.length > 0) {
      console.log(chalk.yellow('\n⚠ Existing account mappings found:\n'));
      config.accountMappings.forEach(mapping => {
        console.log(chalk.dim(`  ${mapping.monzoAccountName} → ${mapping.actualAccountName}`));
      });

      const { overwrite } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'overwrite',
          message: 'Do you want to replace these mappings?',
          default: false,
        },
      ]);

      if (!overwrite) {
        console.log(chalk.yellow('\n✓ Keeping existing mappings'));
        process.exit(0);
      }
    }

    // Run mapping flow
    const updatedConfig = await runAccountMappingFlow(config);

    // Save updated config
    await saveConfig(updatedConfig);

    console.log(chalk.green('\n✓ Account mappings saved successfully!'));
    console.log(chalk.dim('\nYou can now run: actual-monzo import'));

    process.exit(0);
  } catch (error) {
    console.error(chalk.red('\n❌ Account mapping failed'));
    console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
    process.exit(1);
  }
}

/**
 * Create map-accounts command
 */
export const mapAccountsCommand = new Command('map-accounts')
  .description('Configure account mappings between Monzo and Actual Budget')
  .action(mapAccountsAction);
