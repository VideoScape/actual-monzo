import { describe, expect, it } from 'vitest';
import {
  buildCategoryMapping,
  getMonzoCategoryFromNotes,
  MONZO_TRANSACTION_CATEGORIES,
} from '../../src/utils/category-mapping.js';
import { transformMonzoToActual } from '../../src/utils/transaction-transform.js';
import type { AccountMapping } from '../../src/types/import.js';
import type { MonzoTransaction } from '../../src/types/monzo.js';

const account: AccountMapping = {
  monzoAccountId: 'acc_00009ABC123DEF456',
  monzoAccountName: 'Personal Current Account',
  actualAccountId: '550e8400-e29b-41d4-a716-446655440000',
  actualAccountName: 'Monzo Personal',
};

const transaction: MonzoTransaction = {
  id: 'tx_category123',
  account_id: account.monzoAccountId,
  amount: -1250,
  created: '2026-08-20T09:30:00.000Z',
  settled: '2026-08-20T09:30:01.000Z',
  currency: 'GBP',
  description: 'Lunch',
  category: 'eating_out',
};

describe('Monzo category mapping', () => {
  it('adds an Actual category to newly transformed transactions', () => {
    const transformed = transformMonzoToActual(
      transaction,
      account,
      '541836f1-e756-4473-a5d0-6c1d3f06c7fa'
    );

    expect(transformed.category).toBe('541836f1-e756-4473-a5d0-6c1d3f06c7fa');
    expect(transformed.notes).toBe('Monzo: eating_out | ID: tx_category123');
  });

  it('leaves new transactions uncategorized when no mapping exists', () => {
    expect(transformMonzoToActual(transaction, account).category).toBeUndefined();
  });

  it('recovers categories from historical import notes but ignores Pot transfers', () => {
    expect(getMonzoCategoryFromNotes('Monzo: groceries | ID: tx_old')).toBe('groceries');
    expect(getMonzoCategoryFromNotes('Monzo Pot transfer: Bills | ID: tx_pot')).toBeUndefined();
    expect(getMonzoCategoryFromNotes()).toBeUndefined();
  });

  it('does not offer generic transfers as a spending category', () => {
    expect(MONZO_TRANSACTION_CATEGORIES).not.toContain('transfers');
    const mappings = buildCategoryMapping([
      {
        monzoCategory: 'groceries',
        actualCategoryId: '541836f1-e756-4473-a5d0-6c1d3f06c7fa',
        actualCategoryName: 'Food',
      },
    ]);
    expect(mappings.get('groceries')).toBe('541836f1-e756-4473-a5d0-6c1d3f06c7fa');
    expect(mappings.get('transfers')).toBeUndefined();
  });
});
