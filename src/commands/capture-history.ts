import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig, saveConfig } from '../utils/config-manager.js';
import { saveHistorySnapshot } from '../utils/history-snapshot.js';
import { MonzoOAuthService } from '../services/monzo-oauth-service.js';
import { MonzoApiClient } from '../services/monzo-api-client.js';
import { mapOpenPots } from './map-pots.js';
import type { HistorySnapshot } from '../types/history-snapshot.js';

const COMPLETE_HISTORY_START = '2000-01-01T00:00:00.000Z';

async function captureHistoryAction(): Promise<void> {
  try {
    const config = await loadConfig();
    const mappings = config.accountMappings;
    if (!mappings?.length) {
      throw new Error('No account mappings configured. Run actual-monzo map-accounts first.');
    }

    console.log(chalk.bold('\n🗄️  Capture complete Monzo history\n'));
    console.log(
      chalk.yellow(
        'Monzo allows complete transaction history for about five minutes after authentication.'
      )
    );

    const oauth = new MonzoOAuthService();
    const monzo = await oauth.startOAuthFlow({
      clientId: config.monzo.clientId,
      clientSecret: config.monzo.clientSecret,
    });
    const updatedConfig = { ...config, monzo };
    await saveConfig(updatedConfig);

    const client = new MonzoApiClient();
    const capturedAt = new Date();
    const end = capturedAt.toISOString();
    const spinner = ora('Capturing all transaction history from Monzo...').start();

    const captured = await Promise.all(
      mappings.map(async mapping => {
        const transactions = await client.getTransactions(
          mapping.monzoAccountId,
          COMPLETE_HISTORY_START,
          end,
          monzo.accessToken!
        );
        return [mapping.monzoAccountId, transactions] as const;
      })
    );

    const snapshot: HistorySnapshot = {
      formatVersion: 1,
      capturedAt: capturedAt.toISOString(),
      start: COMPLETE_HISTORY_START,
      end,
      transactionsByAccount: Object.fromEntries(captured),
    };
    const snapshotPath = await saveHistorySnapshot(snapshot);
    const total = captured.reduce((count, [, transactions]) => count + transactions.length, 0);
    spinner.succeed(`Captured ${total} transaction(s) across ${captured.length} account(s)`);

    console.log(chalk.cyan('Mapping open and archived Pots referenced by full history...'));
    const potConfig = await mapOpenPots(updatedConfig, true);
    await saveConfig(potConfig);

    console.log(chalk.green('\n✓ Full Monzo history safely captured'));
    console.log(`Snapshot: ${snapshotPath}`);
    console.log(chalk.dim(`Import it with: actual-monzo import --snapshot ${snapshotPath}`));
  } catch (error) {
    console.error(chalk.red('\n❌ Full-history capture failed'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}

export const captureHistoryCommand = new Command('capture-history')
  .description('Reauthenticate and securely capture complete Monzo transaction history')
  .action(captureHistoryAction);
