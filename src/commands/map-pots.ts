/**
 * Discover open Monzo Pots and map each one to a dedicated on-budget Actual account.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as actualApi from '@actual-app/api';
import * as path from 'path';
import { loadConfig, saveConfig } from '../utils/config-manager.js';
import { MonzoApiClient } from '../services/monzo-api-client.js';
import { checkServerCompatibility } from '../utils/actual-version-check.js';
import { suppressConsole } from '../utils/cli-utils.js';
import type { Config } from '../utils/config-schema.js';
import type { PotMapping } from '../types/import.js';
import type { MonzoPot } from '../types/monzo.js';

interface ActualAccount {
  id: string;
  name: string;
  closed?: boolean;
}

interface ActualBudget {
  groupId: string;
  name?: string;
}

function resolveDataDirectory(dataDirectory: string): string {
  if (dataDirectory.startsWith('~')) {
    return dataDirectory.replace('~', process.env.HOME ?? '');
  }
  if (dataDirectory.startsWith('.')) {
    return path.resolve(process.cwd(), dataDirectory);
  }
  return dataDirectory;
}

function potAccountName(pot: MonzoPot): string {
  return `Monzo Pot - ${pot.name.trim()}${pot.deleted ? ' (Archived)' : ''}`;
}

export async function mapOpenPots(config: Config, includeDeleted = false): Promise<Config> {
  if (!config.monzo.accessToken) {
    throw new Error('Monzo access token missing. Run: actual-monzo setup');
  }
  if (!config.accountMappings?.length) {
    throw new Error('Map the parent Monzo accounts first. Run: actual-monzo map-accounts');
  }

  const client = new MonzoApiClient();
  const discovered = new Map<string, { pot: MonzoPot; parentAccountId: string }>();

  for (const mapping of config.accountMappings) {
    const pots = await client.getPots(mapping.monzoAccountId, config.monzo.accessToken);
    for (const pot of pots.filter(candidate => includeDeleted || !candidate.deleted)) {
      discovered.set(pot.id, { pot, parentAccountId: mapping.monzoAccountId });
    }
  }

  const compatibility = await checkServerCompatibility(config.actualBudget.serverUrl);
  if (!compatibility.compatible) {
    throw new Error(compatibility.message);
  }

  let budgetOpened = false;
  try {
    await suppressConsole(async () => {
      await actualApi.init({
        serverURL: config.actualBudget.serverUrl,
        password: config.actualBudget.password,
        dataDir: resolveDataDirectory(config.actualBudget.dataDirectory),
      });
    });

    const budgets = (await suppressConsole(() => actualApi.getBudgets())) as ActualBudget[];
    const uniqueBudgets = Array.from(new Map(budgets.map(b => [b.groupId, b])).values());
    if (!uniqueBudgets.length) {
      throw new Error('No budgets found on Actual Budget server');
    }

    const budget =
      uniqueBudgets.find(candidate => candidate.groupId === config.actualBudget.budgetId) ??
      uniqueBudgets[0];
    await suppressConsole(() => actualApi.downloadBudget(budget.groupId));
    budgetOpened = true;
    config.actualBudget.budgetId = budget.groupId;

    const actualAccounts = (await suppressConsole(() =>
      actualApi.getAccounts()
    )) as ActualAccount[];
    const existingMappings = new Map(
      (config.potMappings ?? []).map(mapping => [mapping.monzoPotId, mapping])
    );
    const mappedActualIds = new Set(
      (config.potMappings ?? []).map(mapping => mapping.actualAccountId)
    );
    const newMappings: PotMapping[] = [];

    for (const { pot, parentAccountId } of discovered.values()) {
      const prior = existingMappings.get(pot.id);
      const priorAccount = prior
        ? actualAccounts.find(account => account.id === prior.actualAccountId && !account.closed)
        : undefined;

      if (prior && priorAccount) {
        newMappings.push({
          ...prior,
          monzoPotName: pot.name.trim(),
          actualAccountName: priorAccount.name,
          deleted: Boolean(pot.deleted),
        });
        mappedActualIds.add(priorAccount.id);
        console.log(chalk.green(`  ✓ ${pot.name.trim()} → ${priorAccount.name}`));
        continue;
      }

      let desiredName = potAccountName(pot);
      let actualAccount = actualAccounts.find(
        account =>
          account.name === desiredName && !account.closed && !mappedActualIds.has(account.id)
      );

      if (!actualAccount) {
        const parent = config.accountMappings.find(
          mapping => mapping.monzoAccountId === parentAccountId
        );
        if (actualAccounts.some(account => account.name === desiredName)) {
          desiredName = `${desiredName} (${parent?.actualAccountName ?? 'Monzo'})`;
        }

        const created = await suppressConsole(() =>
          actualApi.createAccount({ name: desiredName, offbudget: false }, 0)
        );
        const createdId = typeof created === 'string' ? created : (created as { id?: string })?.id;
        if (!createdId) {
          throw new Error(`Actual did not return an account ID for Pot ${pot.name.trim()}`);
        }
        actualAccount = { id: createdId, name: desiredName, closed: false };
        actualAccounts.push(actualAccount);
        console.log(chalk.green(`  + Created ${desiredName}`));
      } else {
        console.log(chalk.green(`  ✓ ${pot.name.trim()} → ${actualAccount.name}`));
      }

      mappedActualIds.add(actualAccount.id);
      newMappings.push({
        monzoPotId: pot.id,
        monzoPotName: pot.name.trim(),
        monzoAccountId: parentAccountId,
        actualAccountId: actualAccount.id,
        actualAccountName: actualAccount.name,
        deleted: Boolean(pot.deleted),
      });
    }

    // Retain mappings for deleted Pots so old imports never turn their movements
    // into income or expenses. New open-Pot mappings replace matching old entries.
    const discoveredIds = new Set(newMappings.map(mapping => mapping.monzoPotId));
    const historicalMappings = (config.potMappings ?? []).filter(
      mapping => !discoveredIds.has(mapping.monzoPotId)
    );
    config.potMappings = [...newMappings, ...historicalMappings];
    return config;
  } finally {
    if (budgetOpened) {
      await suppressConsole(async () => {
        await actualApi.shutdown().catch(() => {});
      });
    }
  }
}

async function mapPotsAction(options: { includeDeleted?: boolean }): Promise<void> {
  try {
    const config = await loadConfig();
    console.log(chalk.bold('\n🏺 Monzo Pot Mapping\n'));
    const updated = await mapOpenPots(config, Boolean(options.includeDeleted));
    await saveConfig(updated);
    const openCount = updated.potMappings?.length ?? 0;
    console.log(chalk.green(`\n✓ Saved ${openCount} Pot mapping(s)`));
  } catch (error) {
    console.error(chalk.red('\n❌ Pot mapping failed'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}

export const mapPotsCommand = new Command('map-pots')
  .description('Map open Monzo Pots to dedicated Actual Budget accounts')
  .option('--include-deleted', 'also map deleted Pots needed by full transaction history')
  .action(mapPotsAction);
