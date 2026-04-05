/**
 * Integration Test: OAuth Denial Handling
 *
 * Tests handling of user denial during Monzo OAuth flow
 * and validates proper error reporting.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { vol } from 'memfs';
import nock from 'nock';
import { MonzoOAuthService } from '../../src/services/monzo-oauth-service';
import * as oauthServer from '../../src/utils/oauth-server';
import * as browserUtils from '../../src/utils/browser-utils';
import inquirer from 'inquirer';

// Mock filesystem
vi.mock('fs/promises', () => ({
  ...vol.promises,
  default: vol.promises,
}));

// Mock browser utils module
vi.mock('../../src/utils/browser-utils');

// Mock OAuth server module
vi.mock('../../src/utils/oauth-server');

// Mock inquirer
vi.mock('inquirer');

describe('Integration: OAuth Denial Handling', () => {
  let mockServer: any;

  beforeEach(() => {
    vol.reset();
    vol.mkdirSync(process.cwd(), { recursive: true });
    vi.clearAllMocks();
    nock.cleanAll();

    // Setup default mock server
    mockServer = {
      start: vi.fn().mockResolvedValue(3000),
      waitForCallback: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined as any),
    };

    // Mock browser launch to succeed
    vi.mocked(browserUtils.launchBrowser).mockResolvedValue({
      success: true,
      url: 'https://auth.monzo.com/oauth/authorize',
    });

    // Mock inquirer to select browser mode
    vi.mocked(inquirer.prompt).mockResolvedValue({ openMethod: 'browser' });

    // Mock getOAuthCallbackPort
    vi.mocked(oauthServer.getOAuthCallbackPort).mockReturnValue(3000);

    // Default: mock createOAuthCallbackServer to return mockServer
    vi.mocked(oauthServer.createOAuthCallbackServer).mockResolvedValue(mockServer);
  });

  afterEach(() => {
    nock.cleanAll();
    vi.restoreAllMocks();
  });

  it('should handle user denying OAuth authorization', async () => {
    const service = new MonzoOAuthService();

    // Mock OAuth callback server to simulate user denial
    mockServer.waitForCallback.mockResolvedValue({
      error: 'access_denied',
      errorDescription: 'The user denied the authorization request',
      state: 'test-state',
    });

    // Attempt OAuth flow
    const params = {
      clientId: 'oauth2client_00009abc123def456',
      clientSecret: 'mnzconf_secret_1234567890abcdef',
    };

    // Should throw error for access_denied
    await expect(service.startOAuthFlow(params)).rejects.toThrow('access_denied');

    // Verify server was started and shutdown
    expect(mockServer.start).toHaveBeenCalled();
    expect(mockServer.waitForCallback).toHaveBeenCalled();
    expect(mockServer.shutdown).toHaveBeenCalled();
  });

  it('should handle missing authorization code in callback', async () => {
    const service = new MonzoOAuthService();

    // Capture the state parameter that will be generated
    let capturedState: string | null = null;
    const originalGenerateUrl = service.generateAuthorizationUrl.bind(service);
    service.generateAuthorizationUrl = vi.fn((clientId, redirectUri, state) => {
      capturedState = state;
      return originalGenerateUrl(clientId, redirectUri, state);
    });

    // Mock OAuth callback server to return callback without code
    mockServer.waitForCallback.mockImplementation(async () => {
      return {
        state: capturedState,
        // No code or error
      };
    });

    // Attempt OAuth flow
    const params = {
      clientId: 'oauth2client_00009abc123def456',
      clientSecret: 'mnzconf_secret_1234567890abcdef',
    };

    // Should throw error for missing authorization code
    await expect(service.startOAuthFlow(params)).rejects.toThrow('No authorization code');

    // Verify server was started and shutdown
    expect(mockServer.start).toHaveBeenCalled();
    expect(mockServer.waitForCallback).toHaveBeenCalled();
    expect(mockServer.shutdown).toHaveBeenCalled();
  });

  it('should handle CSRF state mismatch', async () => {
    const service = new MonzoOAuthService();

    // Mock OAuth callback server to return different state
    mockServer.waitForCallback.mockResolvedValue({
      code: 'auth_code_12345',
      state: 'wrong-state',
    });

    // Attempt OAuth flow
    const params = {
      clientId: 'oauth2client_00009abc123def456',
      clientSecret: 'mnzconf_secret_1234567890abcdef',
    };

    // Should throw error for state mismatch
    await expect(service.startOAuthFlow(params)).rejects.toThrow('State parameter mismatch');

    // Verify server was started and shutdown
    expect(mockServer.start).toHaveBeenCalled();
    expect(mockServer.waitForCallback).toHaveBeenCalled();
    expect(mockServer.shutdown).toHaveBeenCalled();
  });

  it('should handle token exchange failure after authorization', async () => {
    const service = new MonzoOAuthService();

    // Capture the state parameter that will be generated
    let capturedState: string | null = null;
    const originalGenerateUrl = service.generateAuthorizationUrl.bind(service);
    service.generateAuthorizationUrl = vi.fn((clientId, redirectUri, state) => {
      capturedState = state;
      return originalGenerateUrl(clientId, redirectUri, state);
    });

    // Mock OAuth callback server to return valid code and state
    mockServer.waitForCallback.mockImplementation(async () => {
      return {
        code: 'auth_code_12345',
        state: capturedState,
      };
    });

    // Mock token exchange to fail
    nock('https://api.monzo.com').post('/oauth2/token').reply(400, {
      error: 'invalid_grant',
      error_description: 'Authorization code has expired',
    });

    // Attempt OAuth flow
    const params = {
      clientId: 'oauth2client_00009abc123def456',
      clientSecret: 'mnzconf_secret_1234567890abcdef',
    };

    // Should throw error for token exchange failure
    await expect(service.startOAuthFlow(params)).rejects.toThrow();

    // Verify server was started and shutdown
    expect(mockServer.start).toHaveBeenCalled();
    expect(mockServer.waitForCallback).toHaveBeenCalled();
    expect(mockServer.shutdown).toHaveBeenCalled();
  });

  it('should not create config file when OAuth is denied', async () => {
    const service = new MonzoOAuthService();

    // Mock OAuth callback server to simulate user denial
    mockServer.waitForCallback.mockResolvedValue({
      error: 'access_denied',
      errorDescription: 'The user denied the authorization request',
      state: 'test-state',
    });

    // Attempt OAuth flow
    const params = {
      clientId: 'oauth2client_00009abc123def456',
      clientSecret: 'mnzconf_secret_1234567890abcdef',
    };

    await expect(service.startOAuthFlow(params)).rejects.toThrow();

    // Verify no config file was created
    const configPath = process.cwd() + '/config.yaml';
    const configExists = vol.existsSync(configPath);
    expect(configExists).toBe(false);
  });
});
