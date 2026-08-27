import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { MonzoApiClient } from '../../src/services/monzo-api-client.js';

describe('Monzo transaction date ranges', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("splits long history requests below Monzo's one-year limit and deduplicates boundaries", async () => {
    const duplicate = {
      id: 'tx_boundary_duplicate',
      account_id: 'acc_test',
      amount: 100,
      created: '2024-01-01T00:00:00.000Z',
      currency: 'GBP',
      description: 'Boundary transaction',
      decline_reason: null,
    };
    const get = vi.spyOn(axios, 'get').mockResolvedValue({
      data: { transactions: [duplicate] },
    });

    const transactions = await new MonzoApiClient().getTransactions(
      'acc_test',
      '2022-01-01T00:00:00.000Z',
      '2024-03-15T00:00:00.000Z',
      'access-token'
    );

    expect(get).toHaveBeenCalledTimes(3);
    for (const [, request] of get.mock.calls) {
      const params = request?.params as { since: string; before: string };
      const duration = Date.parse(params.before) - Date.parse(params.since);
      expect(duration).toBeGreaterThan(0);
      expect(duration).toBeLessThan(365 * 24 * 60 * 60 * 1000);
    }
    expect(transactions).toEqual([duplicate]);
  });
});
