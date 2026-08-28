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
  PotMapping,
  MonzoTransaction,
} from '../types/import.js';
import type { Config } from '../utils/config-schema.js';
import { MonzoApiClient } from './monzo-api-client.js';
import {
  calculatePotBalanceAdjustment,
  getPotToPotDeduplicationKey,
  isPotToPotTransfer,
  isPotTransfer,
  transformCurrentToPotTransfer,
  transformMonzoToActual,
  transformPotToPotTransfer,
} from '../utils/transaction-transform.js';
import { recordImportSession } from '../utils/import-history.js';
import { saveConfig } from '../utils/config-manager.js';
import * as actualApi from '@actual-app/api';
import * as path from 'path';
import type { Ora } from 'ora';
import { checkServerCompatibility } from '../utils/actual-version-check.js';
import { getMonzoAccountDisplayName } from '../utils/account-names.js';
import { validateActualMappings } from '../utils/mapping-validation.js';
import { buildCategoryMapping } from '../utils/category-mapping.js';

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
    spinner?: Ora,
    prefetchedTransactions?: ReadonlyMap<string, MonzoTransaction[]>
  ): Promise<ImportSession> {
    // Refresh token if expired or expiring soon
    const refreshedConfig = await this.refreshTokenIfNeeded(config);

    const monzoAccounts = await this.monzoClient.getAccounts(refreshedConfig.monzo.accessToken!);
    let accountLabelsChanged = false;
    for (const mapping of refreshedConfig.accountMappings ?? []) {
      const account = monzoAccounts.find(candidate => candidate.id === mapping.monzoAccountId);
      if (!account || account.closed) {
        continue;
      }
      const displayName = getMonzoAccountDisplayName(account);
      if (mapping.monzoAccountName !== displayName) {
        mapping.monzoAccountName = displayName;
        accountLabelsChanged = true;
      }
    }
    if (accountLabelsChanged) {
      await saveConfig(refreshedConfig);
    }

    const session: ImportSession = {
      startTime: new Date(),
      dateRange,
      accountsProcessed: mappings.length,
      successfulAccounts: [],
      failedAccounts: [],
      totalTransactions: 0,
      declinedFiltered: 0,
      potTransfers: 0,
      potToPotTransfers: 0,
      potTransfersSkipped: 0,
      potBalancesInitialized: 0,
      potBalancesPending: 0,
    };

    let transferPayeeByAccountId = new Map<string, string>();

    if (dryRun) {
      // A preview does not connect to or mutate Actual. Placeholder payee IDs let
      // the transformation run while map-pots remains responsible for validation.
      transferPayeeByAccountId = new Map(
        (refreshedConfig.potMappings ?? []).map(mapping => [
          mapping.actualAccountId,
          `preview-transfer:${mapping.actualAccountId}`,
        ])
      );
    } else {
      try {
        let dataDir = refreshedConfig.actualBudget.dataDirectory;
        if (dataDir.startsWith('~')) {
          dataDir = dataDir.replace('~', process.env.HOME ?? '');
        } else if (dataDir.startsWith('.')) {
          dataDir = path.resolve(process.cwd(), dataDir);
        }

        const versionCheck = await checkServerCompatibility(refreshedConfig.actualBudget.serverUrl);
        if (!versionCheck.compatible) {
          throw new Error(versionCheck.message);
        }

        await actualApi.init({
          serverURL: refreshedConfig.actualBudget.serverUrl,
          password: refreshedConfig.actualBudget.password,
          dataDir,
        });

        const budgets = (await actualApi.getBudgets()) as Array<{ groupId: string; name?: string }>;
        const uniqueBudgets = Array.from(new Map(budgets.map(b => [b.groupId, b])).values());
        if (!uniqueBudgets.length) {
          throw new Error('No budgets found on Actual Budget server');
        }

        const budget =
          uniqueBudgets.find(
            candidate => candidate.groupId === refreshedConfig.actualBudget.budgetId
          ) ?? uniqueBudgets[0];
        await actualApi.downloadBudget(budget.groupId);

        const actualAccounts = (await actualApi.getAccounts()) as Array<{
          id: string;
          name: string;
          closed?: boolean;
        }>;
        validateActualMappings(actualAccounts, mappings, refreshedConfig.potMappings ?? []);

        const payees = (await actualApi.getPayees()) as Array<{
          id: string;
          transfer_acct?: string | null;
        }>;
        transferPayeeByAccountId = new Map(
          payees
            .filter(payee => Boolean(payee.transfer_acct))
            .map(payee => [payee.transfer_acct!, payee.id])
        );
      } catch (error) {
        throw new Error(
          `Failed to initialize Actual Budget: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    try {
      const potMappings = refreshedConfig.potMappings ?? [];
      const potMappingById = new Map<string, PotMapping>(
        potMappings.map(mapping => [mapping.monzoPotId, mapping])
      );
      const currentPotBalanceById = new Map<string, number>();
      const categoryMapping = buildCategoryMapping(refreshedConfig.categoryMappings);

      if (potMappings.length > 0) {
        const parentAccountIds = new Set(potMappings.map(mapping => mapping.monzoAccountId));
        for (const parentAccountId of parentAccountIds) {
          const pots = await this.monzoClient.getPots(
            parentAccountId,
            refreshedConfig.monzo.accessToken!
          );
          for (const pot of pots) {
            currentPotBalanceById.set(pot.id, pot.balance);
          }
        }
      }

      // Process each account mapping
      for (const mapping of mappings) {
        try {
          if (spinner) {
            spinner.text = `Fetching transactions from ${mapping.monzoAccountName}...`;
          }

          // Fetch transactions from Monzo
          const since = dateRange.start.toISOString();
          const before = dateRange.end.toISOString();

          const monzoTransactions =
            prefetchedTransactions?.get(mapping.monzoAccountId) ??
            (await this.monzoClient.getTransactions(
              mapping.monzoAccountId,
              since,
              before,
              refreshedConfig.monzo.accessToken!
            ));

          const transactionsByActualAccount = new Map<string, ActualTransaction[]>();
          const potToPotTransactionsByActualAccount = new Map<string, ActualTransaction[]>();
          const seenPotToPotTransfers = new Set<string>();
          const appendTransaction = (transaction: ActualTransaction): void => {
            const transactions = transactionsByActualAccount.get(transaction.account) ?? [];
            transactions.push(transaction);
            transactionsByActualAccount.set(transaction.account, transactions);
          };
          const appendPotToPotTransaction = (transaction: ActualTransaction): void => {
            const transactions = potToPotTransactionsByActualAccount.get(transaction.account) ?? [];
            transactions.push(transaction);
            potToPotTransactionsByActualAccount.set(transaction.account, transactions);
          };

          for (const monzoTransaction of monzoTransactions) {
            if (monzoTransaction.amount === 0) {
              continue;
            }

            if (!isPotTransfer(monzoTransaction)) {
              appendTransaction(
                transformMonzoToActual(
                  monzoTransaction,
                  mapping,
                  categoryMapping.get(monzoTransaction.category)
                )
              );
              continue;
            }

            const destinationPotId = monzoTransaction.metadata?.pot_id;
            const destinationPot = destinationPotId
              ? potMappingById.get(destinationPotId)
              : undefined;

            if (isPotToPotTransfer(monzoTransaction)) {
              const transferKey = getPotToPotDeduplicationKey(monzoTransaction);
              if (seenPotToPotTransfers.has(transferKey)) {
                continue;
              }
              seenPotToPotTransfers.add(transferKey);

              const sourcePotId = monzoTransaction.metadata?.source_pot_id;
              const sourcePot = sourcePotId ? potMappingById.get(sourcePotId) : undefined;
              const destinationPayee = destinationPot
                ? transferPayeeByAccountId.get(destinationPot.actualAccountId)
                : undefined;

              if (!sourcePot || !destinationPot || !destinationPayee) {
                session.potTransfersSkipped++;
                continue;
              }

              appendPotToPotTransaction(
                transformPotToPotTransfer(
                  monzoTransaction,
                  sourcePot,
                  destinationPot,
                  destinationPayee
                )
              );
              session.potTransfers++;
              session.potToPotTransfers++;
              continue;
            }

            const destinationPayee = destinationPot
              ? transferPayeeByAccountId.get(destinationPot.actualAccountId)
              : undefined;
            if (!destinationPot || !destinationPayee) {
              session.potTransfersSkipped++;
              continue;
            }

            appendTransaction(
              transformCurrentToPotTransfer(
                monzoTransaction,
                mapping,
                destinationPot,
                destinationPayee
              )
            );
            session.potTransfers++;
          }

          const actualTransactionCount =
            Array.from(transactionsByActualAccount.values()).reduce(
              (count, transactions) => count + transactions.length,
              0
            ) +
            Array.from(potToPotTransactionsByActualAccount.values()).reduce(
              (count, transactions) => count + transactions.length,
              0
            );

          if (spinner) {
            const verb = dryRun ? 'Processing' : 'Importing';
            spinner.text = `${verb} ${mapping.monzoAccountName} (${actualTransactionCount} transactions)`;
          }

          // Import to Actual Budget (unless dry run)
          if (!dryRun) {
            for (const [actualAccountId, actualTransactions] of transactionsByActualAccount) {
              if (!actualTransactions.length) {
                continue;
              }
              const result = await actualApi.importTransactions(
                actualAccountId,
                actualTransactions
              );
              session.totalTransactions += result.added.length;
            }
            for (const [
              actualAccountId,
              potToPotTransactions,
            ] of potToPotTransactionsByActualAccount) {
              const existing = (await actualApi.getTransactions(
                actualAccountId,
                dateRange.start.toISOString().split('T')[0],
                dateRange.end.toISOString().split('T')[0]
              )) as ActualTransaction[];
              const existingImportIds = new Set(
                existing.map(transaction => transaction.imported_id)
              );
              const newTransactions = potToPotTransactions.filter(
                transaction => !existingImportIds.has(transaction.imported_id)
              );
              if (!newTransactions.length) {
                continue;
              }
              await actualApi.addTransactions(
                actualAccountId,
                newTransactions.map(transaction => {
                  const { account, ...transactionWithoutAccount } = transaction;
                  if (account !== actualAccountId) {
                    throw new Error('Pot transfer was assigned to the wrong Actual account');
                  }
                  return transactionWithoutAccount;
                }),
                { runTransfers: true }
              );
              session.totalTransactions += newTransactions.length;
            }
          } else if (dryRun) {
            session.totalTransactions += actualTransactionCount;
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

      const uninitializedPots = potMappings.filter(mapping => !mapping.balanceInitializedAt);
      if (dryRun) {
        session.potBalancesPending = uninitializedPots.length;
      } else {
        let configChanged = false;
        const completedParentAccounts = new Set(session.successfulAccounts);

        for (const potMapping of uninitializedPots) {
          if (!completedParentAccounts.has(potMapping.monzoAccountId)) {
            continue;
          }
          const monzoBalance = currentPotBalanceById.get(potMapping.monzoPotId);
          if (monzoBalance === undefined) {
            continue;
          }

          const actualBalance = (await actualApi.getAccountBalance(
            potMapping.actualAccountId
          )) as number;
          const adjustment = calculatePotBalanceAdjustment(monzoBalance, actualBalance);

          if (adjustment !== 0) {
            const result = await actualApi.importTransactions(potMapping.actualAccountId, [
              {
                account: potMapping.actualAccountId,
                date: dateRange.start.toISOString().split('T')[0],
                amount: adjustment,
                payee_name: 'Monzo Pot opening balance',
                notes: `One-time balance reconciliation for Monzo Pot ${potMapping.monzoPotName}`,
                imported_id: `actual-monzo-pot-opening-${potMapping.monzoPotId}`,
                cleared: true,
              },
            ]);
            session.totalTransactions += result.added.length;
          }

          potMapping.balanceInitializedAt = new Date().toISOString();
          session.potBalancesInitialized++;
          configChanged = true;
        }

        if (configChanged) {
          refreshedConfig.potMappings = potMappings;
          await saveConfig(refreshedConfig);
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
