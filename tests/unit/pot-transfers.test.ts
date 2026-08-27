import { describe, expect, it } from 'vitest';
import {
  calculatePotBalanceAdjustment,
  getPotToPotDeduplicationKey,
  isPotToPotTransfer,
  isPotTransfer,
  transformCurrentToPotTransfer,
  transformPotToPotTransfer,
} from '../../src/utils/transaction-transform.js';
import type { AccountMapping, PotMapping } from '../../src/types/import.js';
import type { MonzoTransaction } from '../../src/types/monzo.js';

const currentAccount: AccountMapping = {
  monzoAccountId: 'acc_00009ABC123DEF456',
  monzoAccountName: 'Personal Current Account',
  actualAccountId: '550e8400-e29b-41d4-a716-446655440000',
  actualAccountName: 'Monzo',
};

const sourcePot: PotMapping = {
  monzoPotId: 'pot_source123',
  monzoPotName: 'Temporary',
  monzoAccountId: currentAccount.monzoAccountId,
  actualAccountId: '123e4567-e89b-12d3-a456-426614174000',
  actualAccountName: 'Monzo Pot - Temporary',
};

const destinationPot: PotMapping = {
  monzoPotId: 'pot_destination456',
  monzoPotName: 'Bills',
  monzoAccountId: currentAccount.monzoAccountId,
  actualAccountId: '9f1c5f62-03ba-4f8d-8105-104d1bd12986',
  actualAccountName: 'Monzo Pot - Bills',
};

function transaction(metadata: Record<string, string>, amount = -1000): MonzoTransaction {
  return {
    id: 'tx_pot123',
    account_id: currentAccount.monzoAccountId,
    amount,
    created: '2026-08-20T09:30:00.000Z',
    settled: '2026-08-20T09:30:01.000Z',
    currency: 'GBP',
    description: destinationPot.monzoPotId,
    metadata,
  };
}

describe('Monzo Pot transfer transformation', () => {
  it('recognises deposit and withdrawal records but not ordinary payments', () => {
    expect(
      isPotTransfer(
        transaction({ pot_id: destinationPot.monzoPotId, pot_deposit_id: 'potdep_123' })
      )
    ).toBe(true);
    expect(
      isPotTransfer(
        transaction({ pot_id: destinationPot.monzoPotId, pot_withdrawal_id: 'potwith_123' })
      )
    ).toBe(true);
    expect(isPotTransfer(transaction({ pot_id: destinationPot.monzoPotId }))).toBe(false);
  });

  it('uses the Pot account transfer payee for a current-account movement', () => {
    const actual = transformCurrentToPotTransfer(
      transaction({ pot_id: destinationPot.monzoPotId, pot_deposit_id: 'potdep_123' }),
      currentAccount,
      destinationPot,
      'transfer-payee-bills'
    );

    expect(actual).toMatchObject({
      account: currentAccount.actualAccountId,
      amount: -1000,
      payee: 'transfer-payee-bills',
      imported_id: 'tx_pot123',
      date: '2026-08-20',
    });
    expect(actual.payee_name).toBeUndefined();
  });

  it('moves Pot-to-Pot money directly from source to destination', () => {
    const monzo = transaction({
      pot_id: destinationPot.monzoPotId,
      source_pot_id: sourcePot.monzoPotId,
      is_pot_to_pot_transfer: 'true',
      pot_deposit_id: 'potdep_123',
      pot_withdrawal_id: 'potwith_123',
    });

    expect(isPotToPotTransfer(monzo)).toBe(true);
    expect(
      transformPotToPotTransfer(monzo, sourcePot, destinationPot, 'transfer-payee-bills')
    ).toMatchObject({
      account: sourcePot.actualAccountId,
      amount: -1000,
      payee: 'transfer-payee-bills',
      imported_id: 'actual-monzo-pot2pot-tx_pot123',
    });
  });

  it('calculates the one-time opening adjustment needed to match Monzo', () => {
    expect(calculatePotBalanceAdjustment(0, -19690)).toBe(19690);
    expect(calculatePotBalanceAdjustment(5000, 5000)).toBe(0);
  });

  it('deduplicates the two ledger records for one Pot-to-Pot movement', () => {
    const first = transaction({
      pot_id: destinationPot.monzoPotId,
      source_pot_id: sourcePot.monzoPotId,
      move_money_transfer_id: 'move_123',
    });
    const second = { ...first, id: 'tx_other_half' };
    expect(getPotToPotDeduplicationKey(first)).toBe('move_123');
    expect(getPotToPotDeduplicationKey(second)).toBe('move_123');
  });
});
