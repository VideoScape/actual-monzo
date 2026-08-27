import { describe, expect, it } from 'vitest';
import { validateActualMappings } from '../../src/utils/mapping-validation.js';
import type { AccountMapping, PotMapping } from '../../src/types/import.js';

const accountMapping: AccountMapping = {
  monzoAccountId: 'acc_00009ABC123DEF456',
  monzoAccountName: 'Chris - Personal Current Account',
  actualAccountId: '550e8400-e29b-41d4-a716-446655440000',
  actualAccountName: 'Monzo',
};

const potMapping: PotMapping = {
  monzoPotId: 'pot_bills123',
  monzoPotName: 'Bills',
  monzoAccountId: accountMapping.monzoAccountId,
  actualAccountId: '123e4567-e89b-12d3-a456-426614174000',
  actualAccountName: 'Monzo Pot - Bills',
};

describe('Actual mapping validation', () => {
  it('accepts mappings to open accounts', () => {
    expect(() =>
      validateActualMappings(
        [
          { id: accountMapping.actualAccountId, name: 'Monzo' },
          { id: potMapping.actualAccountId, name: 'Monzo Pot - Bills' },
        ],
        [accountMapping],
        [potMapping]
      )
    ).not.toThrow();
  });

  it('rejects missing and closed targets before import', () => {
    expect(() =>
      validateActualMappings(
        [{ id: accountMapping.actualAccountId, name: 'Monzo', closed: true }],
        [accountMapping],
        [potMapping]
      )
    ).toThrow(/missing or closed Actual account[\s\S]*map-accounts[\s\S]*map-pots/i);
  });
});
