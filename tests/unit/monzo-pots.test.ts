import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { MonzoApiClient } from '../../src/services/monzo-api-client.js';

describe('Monzo Pot discovery', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls /pots for the mapped current account and retains deleted Pots', async () => {
    const get = vi.spyOn(axios, 'get').mockResolvedValue({
      data: {
        pots: [
          { id: 'pot_open123', name: 'Bills', balance: 5000, currency: 'GBP', deleted: false },
          { id: 'pot_old456', name: 'Old Pot', balance: 0, currency: 'GBP', deleted: true },
        ],
      },
    });

    const result = await new MonzoApiClient().getPots('acc_00009ABC123DEF456', 'access-token');

    expect(get).toHaveBeenCalledWith(
      'https://api.monzo.com/pots',
      expect.objectContaining({
        headers: { Authorization: 'Bearer access-token' },
        params: { current_account_id: 'acc_00009ABC123DEF456' },
      })
    );
    expect(result).toHaveLength(2);
    expect(result[1].deleted).toBe(true);
  });
});
