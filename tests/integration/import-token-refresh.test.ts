/**
 * Integration Test: Import with Token Refresh
 * Tests that ImportService automatically refreshes expired tokens
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nock from 'nock';
import { vol } from 'memfs';
import { ImportService } from '../../src/services/import-service';
import type { Config } from '../../src/utils/config-schema';
import type { DateRange } from '../../src/types/import';

// Mock fs for config file operations
vi.mock('fs/promises', () => ({
  readFile: vi.fn((path, options?) => vol.promises.readFile(path as string, options)),
  writeFile: vi.fn((path, data, options?) => vol.promises.writeFile(path as string, data, options)),
  mkdir: vi.fn((path, options?) => vol.promises.mkdir(path as string, options)),
  access: vi.fn((path, mode?) => vol.promises.access(path as string, mode)),
  stat: vi.fn((path, options?) => vol.promises.stat(path as string, options)),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn((path: string) => vol.existsSync(path)),
  },
  existsSync: vi.fn((path: string) => vol.existsSync(path)),
}));

describe('Integration: Import Token Refresh', () => {
  const MONZO_API_BASE = 'https://api.monzo.com';
  const CONFIG_PATH = process.cwd() + '/config.yaml';

  beforeEach(() => {
    vol.reset();
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('should automatically refresh expired token before import', async () => {
    // Setup: Config with expired token (using realistic format values)
    const expiredConfig: Config = {
      monzo: {
        clientId: 'oauth2client_0000000000000test123456',
        clientSecret: 'mnzconf_secret123456789012345678901234567890',
        accessToken: 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.expired_test_token',
        refreshToken: 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.valid_refresh_token_test',
        tokenExpiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // Expired 1 hour ago
        authorizedAt: new Date(Date.now() - 70 * 60 * 1000).toISOString(),
      },
      actualBudget: {
        serverUrl: 'http://localhost:5006',
        password: 'test-password',
        dataDirectory: './data',
      },
      accountMappings: [
        {
          monzoAccountId: 'acc_00000Ayn0000000000000',
          monzoAccountName: 'Test Account',
          actualAccountId: '12345678-1234-5678-9234-567812345678',
          actualAccountName: 'Test Actual',
        },
      ],
    };

    // Write config
    const { dump } = await import('js-yaml');
    vol.fromJSON({
      [CONFIG_PATH]: dump(expiredConfig),
    });

    // Mock token refresh
    const newAccessToken = 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.new_access_token_refreshed';
    const newRefreshToken = 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.new_refresh_token_test';
    nock(MONZO_API_BASE)
      .post('/oauth2/token', body => {
        return (
          body.grant_type === 'refresh_token' &&
          body.refresh_token === 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.valid_refresh_token_test'
        );
      })
      .reply(200, {
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
        expires_in: 108000, // 30 hours
        token_type: 'Bearer',
      });

    // Mock transactions API call with new token
    nock(MONZO_API_BASE)
      .get('/accounts')
      .matchHeader('Authorization', `Bearer ${newAccessToken}`)
      .reply(200, { accounts: [] });

    nock(MONZO_API_BASE)
      .get('/transactions')
      .query(true)
      .matchHeader('Authorization', `Bearer ${newAccessToken}`)
      .reply(200, {
        transactions: [],
      });

    const importService = new ImportService();
    const dateRange: DateRange = {
      start: new Date('2025-10-01'),
      end: new Date('2025-10-02'),
    };

    // Execute import - should refresh token automatically
    await importService.executeImport(
      expiredConfig,
      expiredConfig.accountMappings!,
      dateRange,
      true // dry run
    );

    // Verify config was updated with new tokens
    const { load } = await import('js-yaml');
    const updatedConfig = load(vol.readFileSync(CONFIG_PATH, 'utf-8') as string) as Config;

    expect(updatedConfig.monzo.accessToken).toBe(newAccessToken);
    expect(updatedConfig.monzo.refreshToken).toBe(newRefreshToken);
    expect(new Date(updatedConfig.monzo.tokenExpiresAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it('should fail gracefully when refresh token is invalid', async () => {
    const expiredConfig: Config = {
      monzo: {
        clientId: 'oauth2client_0000000000000test123456',
        clientSecret: 'mnzconf_secret123456789012345678901234567890',
        accessToken: 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.expired_test_token',
        refreshToken: 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.invalid_refresh_token_test',
        tokenExpiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        authorizedAt: new Date(Date.now() - 70 * 60 * 1000).toISOString(),
      },
      actualBudget: {
        serverUrl: 'http://localhost:5006',
        password: 'test-password',
        dataDirectory: './data',
      },
      accountMappings: [
        {
          monzoAccountId: 'acc_00000Ayn0000000000000',
          monzoAccountName: 'Test Account',
          actualAccountId: '12345678-1234-5678-9234-567812345678',
          actualAccountName: 'Test Actual',
        },
      ],
    };

    const { dump } = await import('js-yaml');
    vol.fromJSON({
      [CONFIG_PATH]: dump(expiredConfig),
    });

    // Mock failed token refresh
    nock(MONZO_API_BASE).post('/oauth2/token').reply(400, {
      error: 'invalid_grant',
      error_description: 'The refresh token is invalid or expired',
    });

    const importService = new ImportService();
    const dateRange: DateRange = {
      start: new Date('2025-10-01'),
      end: new Date('2025-10-02'),
    };

    await expect(
      importService.executeImport(expiredConfig, expiredConfig.accountMappings!, dateRange, true)
    ).rejects.toThrow(/invalid_grant|expired|re-authenticate/i);
  });

  it('should not refresh token if it is still valid', async () => {
    const validConfig: Config = {
      monzo: {
        clientId: 'oauth2client_0000000000000test123456',
        clientSecret: 'mnzconf_secret123456789012345678901234567890',
        accessToken: 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.valid_access_token_test',
        refreshToken: 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.valid_refresh_token_test',
        tokenExpiresAt: new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString(), // Expires in 10 hours
        authorizedAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
      },
      actualBudget: {
        serverUrl: 'http://localhost:5006',
        password: 'test-password',
        dataDirectory: './data',
      },
      accountMappings: [
        {
          monzoAccountId: 'acc_00000Ayn0000000000000',
          monzoAccountName: 'Test Account',
          actualAccountId: '12345678-1234-5678-9234-567812345678',
          actualAccountName: 'Test Actual',
        },
      ],
    };

    const { dump } = await import('js-yaml');
    vol.fromJSON({
      [CONFIG_PATH]: dump(validConfig),
    });

    // Mock transactions API call with existing token (no refresh should occur)
    nock(MONZO_API_BASE)
      .get('/accounts')
      .matchHeader(
        'Authorization',
        `Bearer eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.valid_access_token_test`
      )
      .reply(200, { accounts: [] });

    nock(MONZO_API_BASE)
      .get('/transactions')
      .query(true)
      .matchHeader(
        'Authorization',
        `Bearer eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.valid_access_token_test`
      )
      .reply(200, {
        transactions: [],
      });

    // Should NOT call token refresh endpoint
    const refreshSpy = nock(MONZO_API_BASE).post('/oauth2/token').reply(200, {});

    const importService = new ImportService();
    const dateRange: DateRange = {
      start: new Date('2025-10-01'),
      end: new Date('2025-10-02'),
    };

    await importService.executeImport(validConfig, validConfig.accountMappings!, dateRange, true);

    // Verify refresh endpoint was NOT called
    expect(refreshSpy.isDone()).toBe(false);
  });
});
