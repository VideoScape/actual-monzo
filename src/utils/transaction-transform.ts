/**
 * Transaction transformation utilities
 * Converts Monzo transactions to Actual Budget format
 */

import type {
  MonzoTransaction,
  ActualTransaction,
  AccountMapping,
  PotMapping,
} from '../types/import.js';
import { formatDate } from './date-utils.js';

/**
 * Transform Monzo transaction to Actual Budget format
 *
 * @param monzoTx Monzo transaction from API
 * @param mapping Account mapping configuration
 * @returns ActualTransaction ready for import
 */
export function transformMonzoToActual(
  monzoTx: MonzoTransaction,
  mapping: AccountMapping,
  actualCategoryId?: string
): ActualTransaction {
  // Extract date: use settled if available, otherwise created
  const date = formatDate(monzoTx.settled || monzoTx.created);

  // Extract payee: prefer merchant name, fallback to description
  const payee_name = monzoTx.merchant?.name ?? monzoTx.description;

  // Create notes with Monzo category and transaction ID for reference
  const notes = `Monzo: ${monzoTx.category} | ID: ${monzoTx.id}`;

  // Determine if transaction is cleared (settled vs pending)
  const cleared = !!monzoTx.settled;

  return {
    account: mapping.actualAccountId,
    date,
    amount: monzoTx.amount, // Already in pence/cents
    payee_name,
    notes,
    ...(actualCategoryId ? { category: actualCategoryId } : {}),
    imported_id: monzoTx.id,
    cleared,
  };
}

/** A transaction created by Monzo's deposit/withdraw Pot endpoints. */
export function isPotTransfer(monzoTx: MonzoTransaction): boolean {
  const metadata = monzoTx.metadata;
  return Boolean(
    metadata?.pot_id &&
      (metadata.pot_deposit_id ||
        metadata.pot_withdrawal_id ||
        metadata.source_pot_id ||
        metadata.is_pot_to_pot_transfer === 'true')
  );
}

/** A Pot transfer whose source and destination are both Pots. */
export function isPotToPotTransfer(monzoTx: MonzoTransaction): boolean {
  return Boolean(monzoTx.metadata?.source_pot_id && monzoTx.metadata?.pot_id);
}

/** Monzo can expose both ledger halves of one Pot-to-Pot movement. */
export function getPotToPotDeduplicationKey(monzoTx: MonzoTransaction): string {
  return monzoTx.metadata?.move_money_transfer_id ?? monzoTx.id;
}

/**
 * Transform a current-account side Pot movement into an Actual transfer.
 * Actual creates the linked transaction in the Pot account from the transfer payee.
 */
export function transformCurrentToPotTransfer(
  monzoTx: MonzoTransaction,
  currentAccountMapping: AccountMapping,
  potMapping: PotMapping,
  transferPayeeId: string
): ActualTransaction {
  return {
    account: currentAccountMapping.actualAccountId,
    date: formatDate(monzoTx.settled || monzoTx.created),
    amount: monzoTx.amount,
    payee: transferPayeeId,
    notes: `Monzo Pot transfer: ${potMapping.monzoPotName} | ID: ${monzoTx.id}`,
    imported_id: monzoTx.id,
    cleared: !!monzoTx.settled,
  };
}

/**
 * Transform a Pot-to-Pot movement. It is imported on the source Pot and Actual
 * creates the linked destination transaction, leaving the current account untouched.
 */
export function transformPotToPotTransfer(
  monzoTx: MonzoTransaction,
  sourcePotMapping: PotMapping,
  destinationPotMapping: PotMapping,
  destinationTransferPayeeId: string
): ActualTransaction {
  return {
    account: sourcePotMapping.actualAccountId,
    date: formatDate(monzoTx.settled || monzoTx.created),
    amount: -Math.abs(monzoTx.amount),
    payee: destinationTransferPayeeId,
    notes: `Monzo Pot transfer: ${sourcePotMapping.monzoPotName} → ${destinationPotMapping.monzoPotName} | ID: ${monzoTx.id}`,
    imported_id: `actual-monzo-pot2pot-${monzoTx.id}`,
    cleared: !!monzoTx.settled,
  };
}

/** Amount required to reconcile a new Actual Pot account to Monzo. */
export function calculatePotBalanceAdjustment(
  monzoCurrentBalance: number,
  actualCurrentBalance: number
): number {
  return monzoCurrentBalance - actualCurrentBalance;
}
