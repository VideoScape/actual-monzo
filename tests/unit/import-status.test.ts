import { describe, expect, it } from 'vitest';
import { importSessionHasErrors } from '../../src/commands/import.js';
import type { ImportSession } from '../../src/types/import.js';

function session(overrides: Partial<ImportSession> = {}): ImportSession {
  return {
    startTime: new Date(),
    dateRange: { start: new Date(), end: new Date() },
    accountsProcessed: 1,
    successfulAccounts: ['acc_123'],
    failedAccounts: [],
    totalTransactions: 0,
    declinedFiltered: 0,
    potTransfers: 0,
    potToPotTransfers: 0,
    potTransfersSkipped: 0,
    potBalancesInitialized: 0,
    potBalancesPending: 0,
    ...overrides,
  };
}

describe('import exit status', () => {
  it('succeeds only when every account and Pot movement succeeds', () => {
    expect(importSessionHasErrors(session())).toBe(false);
    expect(
      importSessionHasErrors(
        session({
          failedAccounts: [
            {
              accountId: 'acc_123',
              accountName: 'Monzo',
              error: new Error('network failure'),
              message: 'network failure',
            },
          ],
        })
      )
    ).toBe(true);
    expect(importSessionHasErrors(session({ potTransfersSkipped: 1 }))).toBe(true);
  });
});
