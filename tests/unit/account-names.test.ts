import { describe, expect, it } from 'vitest';
import { getMonzoAccountDisplayName } from '../../src/utils/account-names.js';
import type { MonzoAccount } from '../../src/types/monzo.js';

function account(overrides: Partial<MonzoAccount>): MonzoAccount {
  return {
    id: 'acc_00009ABC123DEF456',
    description: '',
    type: 'uk_retail',
    product_type: 'standard',
    owners: [
      {
        user_id: 'user_123',
        preferred_name: 'Chris',
        preferred_first_name: 'Chris',
      },
    ],
    ...overrides,
  };
}

describe('Monzo account display names', () => {
  it('distinguishes personal, joint, rewards, and business accounts', () => {
    expect(getMonzoAccountDisplayName(account({}))).toBe('Chris - Personal Current Account');
    expect(getMonzoAccountDisplayName(account({ type: 'uk_retail_joint' }))).toBe(
      'Chris - Joint Account'
    );
    expect(
      getMonzoAccountDisplayName(account({ type: 'uk_rewards', product_type: 'rewards' }))
    ).toBe('Chris - Rewards');
    expect(
      getMonzoAccountDisplayName(account({ type: 'uk_business', description: 'Versus Networks' }))
    ).toBe('Chris - Business Account (Versus Networks)');
  });
});
