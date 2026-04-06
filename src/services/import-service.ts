/**
 * Import Service
 * Orchestrates transaction import from Monzo to Actual Budget
 */

import type {
  AccountMapping,
  DateRange,
  ImportSession,
  FailedAccountRecord,
  ActualTransaction,
} from '../types/import.js';
import type { Config } from '../utils/config-schema.js';
import { MonzoApiClient } from './monzo-api-client.js';
import { transformMonzoToActual } from '../utils/transaction-transform.js';
import { recordImportSession } from '../utils/import-history.js';
import { saveConfig } from '../utils/config-manager.js';
import * as actualApi from '@actual-app/api';
import * as path from 'path';
import type { Ora } from 'ora';
import { checkServerCompatibility } from '../utils/actual-version-check.js';

export class ImportService {
  private readonly monzoClient: MonzoApiClient;

  constructor() {
    this.monzoClient = new MonzoApiClient();
  }

  /**
   * Check if access token is expired or expiring soon (within 5 minutes)
   */
  private isTokenExpired(tokenExpiresAt: string | undefined): boolean {
    if (!tokenExpiresAt) {
      return true;
    }

    const expiryTime = new Date(tokenExpiresAt).getTime();
    const now = Date.now();
    const bufferMs = 5 * 60 * 1000; // 5 minutes buffer

    return expiryTime - now < bufferMs;
  }

  /**
   * Refresh Monzo access token and update config
   */
  private async refreshTokenIfNeeded(config: Config): Promise<Config> {
    // Check if token needs refresh
    if (!this.isTokenExpired(config.monzo.tokenExpiresAt)) {
      return config; // Token still valid
    }

    // Validate we have refresh token
    if (!config.monzo.refreshToken) {
      throw new Error(
        'Monzo access token expired and no refresh token available.\n' +
          'Please re-authenticate: actual-monzo setup'
      );
    }

    try {
      // Refresh the token
      const tokenResponse = await this.monzoClient.refreshAccessToken({
        clientId: config.monzo.clientId,
        clientSecret: config.monzo.clientSecret,
        refreshToken: config.monzo.refreshToken,
      });

      // Calculate new expiry time
      const expiresInMs = tokenResponse.expires_in * 1000;
      const tokenExpiresAt = new Date(Date.now() + expiresInMs).toISOString();

      // Update config with new tokens
      const updatedConfig: Config = {
        ...config,
        monzo: {
          ...config.monzo,
          accessToken: tokenResponse.access_token,
          refreshToken: tokenResponse.refresh_token,
          tokenExpiresAt,
        },
      };

      // Save updated config
      await saveConfig(updatedConfig);

      return updatedConfig;
    } catch (error) {
      throw new Error(
        `Failed to refresh Monzo access token: ${error instanceof Error ? error.message : 'Unknown error'}\n` +
          'Please re-authenticate: actual-monzo setup'
      );
    }
  }

  /**
   * Execute transaction import for all mapped accounts
   *
   * @param config Current configuration
   * @param mappings Account mappings to process
   * @param dateRange Date range for import
   * @param dryRun If true, don't actually import (preview only)
   * @param spinner Optional ora spinner for progress updates
   * @returns Completed import session with statistics
   */
  async executeImport(
    config: Config,
    mappings: AccountMapping[],
    dateRange: DateRange,
    dryRun: boolean,
    spinner?: Ora
  ): Promise<ImportSession> {
    // Refresh token if expired or expiring soon
    const refreshedConfig = await this.refreshTokenIfNeeded(config);

    const session: ImportSession = {
      startTime: new Date(),
      dateRange,
      accountsProcessed: mappings.length,
      successfulAccounts: [],
      failedAccounts: [],
      totalTransactions: 0,
      declinedFiltered: 0,
    };

    // Initialize Actual Budget SDK if not dry run
    if (!dryRun) {
      try {
        // Resolve data directory path (expand ~ and relative paths)
        let dataDir = refreshedConfig.actualBudget.dataDirectory;
        if (dataDir.startsWith('~')) {
          dataDir = dataDir.replace('~', process.env.HOME ?? '');
        } else if (dataDir.startsWith('.')) {
          dataDir = path.resolve(process.cwd(), dataDir);
        }

        // Pre-flight version compatibility check
        const versionCheck = await checkServerCompatibility(refreshedConfig.actualBudget.serverUrl);
        if (!versionCheck.compatible) {
          throw new Error(versionCheck.message);
        }

        await actualApi.init({
          serverURL: refreshedConfig.actualBudget.serverUrl,
          password: refreshedConfig.actualBudget.password,
          dataDir: dataDir,
        });

        // Get and download the budget file
        const budgets = await actualApi.getBudgets();
        if (!budgets || budgets.length === 0) {
          throw new Error('No budgets found on Actual Budget server');
        }

        // Use first budget's groupId
        const budgetId = budgets[0].groupId;
        await actualApi.downloadBudget(budgetId);
      } catch (error) {
        throw new Error(
          `Failed to initialize Actual Budget: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    try {
      // Process each account mapping
      for (const mapping of mappings) {
        try {
          if (spinner) {
            spinner.text = `Fetching transactions from ${mapping.monzoAccountName}...`;
          }

          // Fetch transactions from Monzo
          const since = dateRange.start.toISOString();
          const before = dateRange.end.toISOString();

          const monzoTransactions = await this.monzoClient.getTransactions(
            mapping.monzoAccountId,
            since,
            before,
            refreshedConfig.monzo.accessToken!
          );

          // Transform to Actual Budget format
          // Note: Actual Budget handles duplicate detection automatically via imported_id
          const allTransactions: ActualTransaction[] = monzoTransactions.map(tx =>
            transformMonzoToActual(tx, mapping)
          );

          // Filter out zero-amount transactions - they don't represent actual money movement
          // (often authorization holds or system entries)
          const actualTransactions = allTransactions.filter(tx => tx.amount !== 0);

          if (spinner) {
            const verb = dryRun ? 'Processing' : 'Importing';
            spinner.text = `${verb} ${mapping.monzoAccountName} (${actualTransactions.length} transactions)`;
          }

          // Import to Actual Budget (unless dry run)
          if (!dryRun && actualTransactions.length > 0) {
            const result = await actualApi.importTransactions(
              mapping.actualAccountId,
              actualTransactions
            );

            session.totalTransactions += result.added.length;
          } else if (dryRun) {
            session.totalTransactions += actualTransactions.length;
          }

          session.successfulAccounts.push(mapping.monzoAccountId);
        } catch (error) {
          // Record failure but continue with other accounts
          const failureRecord: FailedAccountRecord = {
            accountId: mapping.monzoAccountId,
            accountName: mapping.monzoAccountName,
            error: error instanceof Error ? error : new Error(String(error)),
            message: error instanceof Error ? error.message : String(error),
          };

          session.failedAccounts.push(failureRecord);
        }
      }

      // Save import session log (unless dry run)
      if (!dryRun) {
        await recordImportSession(session.totalTransactions);
      }
    } finally {
      // Always disconnect from Actual Budget
      if (!dryRun) {
        try {
          if (typeof actualApi.shutdown === 'function') {
            await actualApi.shutdown();
          }
        } catch (error) {
          // Non-critical error - ignore
        }
      }
    }

    return session;
  }
}
