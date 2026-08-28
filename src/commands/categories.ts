import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import * as actualApi from '@actual-app/api';
import * as path from 'path';
import { loadConfig, saveConfig } from '../utils/config-manager.js';
import { checkServerCompatibility } from '../utils/actual-version-check.js';
import { suppressConsole } from '../utils/cli-utils.js';
import {
  buildCategoryMapping,
  getMonzoCategoryFromNotes,
  MONZO_TRANSACTION_CATEGORIES,
} from '../utils/category-mapping.js';
import type { CategoryMapping } from '../types/import.js';
import type { Config } from '../utils/config-schema.js';

interface ActualBudget {
  groupId: string;
}

interface ActualCategory {
  id: string;
  name: string;
  group?: string;
  hidden?: boolean;
}

interface ActualTransaction {
  id: string;
  notes?: string | null;
  category?: string | null;
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

async function openConfiguredBudget(config: Config): Promise<ActualCategory[]> {
  const compatibility = await checkServerCompatibility(config.actualBudget.serverUrl);
  if (!compatibility.compatible) throw new Error(compatibility.message);

  await suppressConsole(() =>
    actualApi.init({
      serverURL: config.actualBudget.serverUrl,
      password: config.actualBudget.password,
      dataDir: resolveDataDirectory(config.actualBudget.dataDirectory),
    })
  );
  const budgets = (await suppressConsole(() => actualApi.getBudgets())) as ActualBudget[];
  const uniqueBudgets = Array.from(
    new Map(budgets.map(budget => [budget.groupId, budget])).values()
  );
  if (!uniqueBudgets.length) throw new Error('No budgets found on Actual Budget server');

  const budget =
    uniqueBudgets.find(candidate => candidate.groupId === config.actualBudget.budgetId) ??
    uniqueBudgets[0];
  await suppressConsole(() => actualApi.downloadBudget(budget.groupId));
  config.actualBudget.budgetId = budget.groupId;
  return (await suppressConsole(() => actualApi.getCategories())) as ActualCategory[];
}

async function mapCategoriesAction(): Promise<void> {
  let budgetOpened = false;
  try {
    const config = await loadConfig();
    console.log(chalk.bold('\n🏷️  Monzo Category Mapping\n'));
    const categories = (await openConfiguredBudget(config)).filter(category => !category.hidden);
    budgetOpened = true;
    if (!categories.length) throw new Error('No Actual Budget categories found');

    const existing = new Map(
      (config.categoryMappings ?? []).map(mapping => [mapping.monzoCategory, mapping])
    );
    const mappings: CategoryMapping[] = [];

    for (const monzoCategory of MONZO_TRANSACTION_CATEGORIES) {
      const prior = existing.get(monzoCategory);
      const choices = [
        { name: 'Leave uncategorized', value: '' },
        ...categories.map(category => ({ name: category.name, value: category.id })),
      ];
      const defaultIndex = Math.max(
        0,
        choices.findIndex(choice => choice.value === prior?.actualCategoryId)
      );
      const { actualCategoryId } = await inquirer.prompt<{ actualCategoryId: string }>([
        {
          type: 'list',
          name: 'actualCategoryId',
          message: `${monzoCategory} →`,
          choices,
          default: defaultIndex,
        },
      ]);
      if (!actualCategoryId) continue;
      const actualCategory = categories.find(category => category.id === actualCategoryId);
      if (!actualCategory) continue;
      mappings.push({
        monzoCategory,
        actualCategoryId,
        actualCategoryName: actualCategory.name,
      });
    }

    config.categoryMappings = mappings;
    await saveConfig(config);
    console.log(chalk.green(`\n✓ Saved ${mappings.length} category mapping(s)`));
    console.log(chalk.dim('Run actual-monzo backfill-categories to categorize existing imports.'));
  } catch (error) {
    console.error(chalk.red('\n❌ Category mapping failed'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  } finally {
    if (budgetOpened) await suppressConsole(() => actualApi.shutdown().catch(() => {}));
  }
}

async function backfillCategoriesAction(options: {
  dryRun?: boolean;
  overwrite?: boolean;
}): Promise<void> {
  let budgetOpened = false;
  try {
    const config = await loadConfig();
    const categoryMapping = buildCategoryMapping(config.categoryMappings);
    if (!categoryMapping.size) {
      throw new Error('No category mappings configured. Run: actual-monzo map-categories');
    }
    if (!config.accountMappings?.length) {
      throw new Error('No Monzo account mappings configured');
    }

    const categories = await openConfiguredBudget(config);
    budgetOpened = true;
    const validCategoryIds = new Set(categories.map(category => category.id));
    for (const actualCategoryId of categoryMapping.values()) {
      if (!validCategoryIds.has(actualCategoryId)) {
        throw new Error(`Mapped Actual category no longer exists: ${actualCategoryId}`);
      }
    }

    let scanned = 0;
    let matched = 0;
    let changed = 0;
    const updates: Array<{ id: string; category: string }> = [];

    for (const mapping of config.accountMappings) {
      const transactions = (await actualApi.getTransactions(
        mapping.actualAccountId,
        '2000-01-01',
        '2099-12-31'
      )) as ActualTransaction[];
      for (const transaction of transactions) {
        scanned++;
        const monzoCategory = getMonzoCategoryFromNotes(transaction.notes);
        const actualCategoryId = monzoCategory ? categoryMapping.get(monzoCategory) : undefined;
        if (!actualCategoryId) continue;
        matched++;
        if (transaction.category === actualCategoryId) continue;
        if (transaction.category && !options.overwrite) continue;
        updates.push({ id: transaction.id, category: actualCategoryId });
      }
    }

    if (!options.dryRun && updates.length) {
      await actualApi.batchBudgetUpdates(async () => {
        for (const update of updates) {
          await actualApi.updateTransaction(update.id, { category: update.category });
          changed++;
        }
      });
    } else {
      changed = updates.length;
    }

    const verb = options.dryRun ? 'Would categorize' : 'Categorized';
    console.log(chalk.green(`\n✓ ${verb} ${changed} transaction(s)`));
    console.log(chalk.dim(`Scanned ${scanned}; matched configured Monzo categories on ${matched}`));
    if (!options.overwrite) {
      console.log(chalk.dim('Existing Actual categories were preserved.'));
    }
  } catch (error) {
    console.error(chalk.red('\n❌ Category backfill failed'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  } finally {
    if (budgetOpened) await suppressConsole(() => actualApi.shutdown().catch(() => {}));
  }
}

export const mapCategoriesCommand = new Command('map-categories')
  .description('Map Monzo transaction categories to Actual Budget categories')
  .action(mapCategoriesAction);

export const backfillCategoriesCommand = new Command('backfill-categories')
  .description('Categorize existing Monzo imports from their preserved notes')
  .option('--dry-run', 'preview changes without updating Actual Budget')
  .option('--overwrite', 'replace categories already assigned in Actual Budget')
  .action(backfillCategoriesAction);
