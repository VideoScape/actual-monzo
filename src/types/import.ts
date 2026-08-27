/**
 * Type definitions for transaction import feature
 */

// Re-export MonzoTransaction from the shared monzo types
export type { MonzoTransaction } from './monzo.js';

/**
 * Actual Budget transaction format for import
 */
export interface ActualTransaction {
  account: string;
  date: string;
  amount: number;
  payee?: string;
  payee_name?: string;
  notes?: string;
  imported_id?: string;
  cleared?: boolean;
}

/**
 * Mapping between Monzo account and Actual Budget account
 */
export interface AccountMapping {
  monzoAccountId: string;
  monzoAccountName: string;
  actualAccountId: string;
  actualAccountName: string;
}

/**
 * Mapping between a Monzo Pot and its dedicated Actual Budget account.
 */
export interface PotMapping {
  monzoPotId: string;
  monzoPotName: string;
  monzoAccountId: string;
  actualAccountId: string;
  actualAccountName: string;
  deleted?: boolean;
  balanceInitializedAt?: string;
}

/**
 * Date range for transaction import
 */
export interface DateRange {
  start: Date;
  end: Date;
}

/**
 * Record of failed account import
 */
export interface FailedAccountRecord {
  accountId: string;
  accountName: string;
  error: Error;
  message: string;
}

/**
 * Import session representing a single import command execution
 */
export interface ImportSession {
  startTime: Date;
  dateRange: DateRange;
  accountsProcessed: number;
  successfulAccounts: string[];
  failedAccounts: FailedAccountRecord[];
  totalTransactions: number;
  declinedFiltered: number;
  potTransfers: number;
  potToPotTransfers: number;
  potTransfersSkipped: number;
  potBalancesInitialized: number;
  potBalancesPending: number;
}
