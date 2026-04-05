/**
 * Monzo OAuth Service
 * Orchestrates OAuth 2.0 authorization code flow with Monzo
 */

import { randomUUID } from 'crypto';
import { createOAuthCallbackServer } from '../utils/oauth-server';
import { getOAuthCallbackPort } from '../utils/oauth-server';
import { launchBrowser, formatClickableUrl } from '../utils/browser-utils';
import { MonzoApiClient } from './monzo-api-client';
import type { MonzoConfiguration } from '../types/config';
import type { OAuthCallbackResult } from '../utils/oauth-server';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';

const MONZO_AUTH_URL = 'https://auth.monzo.com/';

export interface OAuthFlowParams {
  clientId: string;
  clientSecret: string;
}

export class MonzoOAuthService {
  private readonly apiClient: MonzoApiClient;

  constructor() {
    this.apiClient = new MonzoApiClient();
  }

  /**
   * Generates Monzo authorization URL
   */
  generateAuthorizationUrl(clientId: string, redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
    });

    return `${MONZO_AUTH_URL}?${params.toString()}`;
  }

  /**
   * Validates state parameter for CSRF protection
   */
  validateState(expected: string, received: string): boolean {
    return expected === received;
  }

  /**
   * Exchanges authorization code for tokens (delegates to API client)
   */
  async exchangeAuthorizationCode(params: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }) {
    return this.apiClient.exchangeAuthorizationCode(params);
  }

  /**
   * Validates access token by calling Monzo API
   */
  async validateAccessToken(accessToken: string): Promise<void> {
    await this.apiClient.whoami(accessToken);
  }

  /**
   * Parses OAuth callback parameters from a redirect URL
   * Used in manual mode when the user pastes the URL from their browser
   */
  parseCallbackUrl(url: string): OAuthCallbackResult {
    try {
      const parsed = new URL(url);
      return {
        code: parsed.searchParams.get('code') ?? undefined,
        state: parsed.searchParams.get('state') ?? undefined,
        error: parsed.searchParams.get('error') ?? undefined,
        errorDescription: parsed.searchParams.get('error_description') ?? undefined,
      };
    } catch {
      throw new Error('Invalid URL. Please paste the full URL from your browser address bar.');
    }
  }

  /**
   * Starts complete OAuth flow with user interaction
   * Returns MonzoConfiguration with tokens
   */
  async startOAuthFlow(params: OAuthFlowParams): Promise<MonzoConfiguration> {
    const spinner = ora('Setting up OAuth authorization...').start();

    try {
      // Generate CSRF token
      const state = randomUUID();

      // Ask user how they want to complete the authorization
      spinner.stop();
      const { openMethod } = await inquirer.prompt([
        {
          type: 'list',
          name: 'openMethod',
          message: 'How would you like to authorize with Monzo?',
          choices: [
            { name: 'Open browser automatically (running locally)', value: 'browser' },
            { name: 'Copy URL manually (running over SSH or headless)', value: 'manual' },
          ],
        },
      ]);

      const isManual = openMethod === 'manual';
      let callback: OAuthCallbackResult;
      const port = getOAuthCallbackPort();
      const redirectUri = `http://localhost:${port}/callback`;

      // Generate authorization URL
      const authUrl = this.generateAuthorizationUrl(params.clientId, redirectUri, state);

      if (isManual) {
        // Manual flow: show URL, user pastes redirect URL back
        console.log(
          chalk.yellow('\nOpen this URL in your browser and approve the request in the Monzo app:')
        );
        console.log(chalk.cyan(formatClickableUrl(authUrl)));
        console.log(
          chalk.dim(
            'After approving, your browser will redirect to a localhost URL that may not load.'
          )
        );
        console.log(
          chalk.dim('Copy the full URL from your browser address bar and paste it below.\n')
        );

        const { redirectUrl } = await inquirer.prompt([
          {
            type: 'input',
            name: 'redirectUrl',
            message: 'Paste the redirect URL:',
            validate: (input: string) => {
              if (!input.trim()) return 'URL cannot be empty';
              try {
                const parsed = new URL(input.trim());
                if (!parsed.searchParams.has('code') && !parsed.searchParams.has('error')) {
                  return 'URL does not contain an authorization code. Make sure you copied the full URL after Monzo redirected you.';
                }
                return true;
              } catch {
                return 'Invalid URL. Please paste the full URL from your browser address bar.';
              }
            },
          },
        ]);

        callback = this.parseCallbackUrl(redirectUrl.trim());
      } else {
        // Automatic flow: start callback server and open browser
        spinner.start('Starting OAuth callback server...');
        const server = await createOAuthCallbackServer();
        const actualPort = await server.start();
        const actualRedirectUri = `http://localhost:${actualPort}/callback`;

        spinner.succeed(`OAuth callback server started on port ${actualPort}`);

        // Regenerate auth URL with actual port if it differs
        const actualAuthUrl =
          actualPort !== port
            ? this.generateAuthorizationUrl(params.clientId, actualRedirectUri, state)
            : authUrl;

        console.log(chalk.blue('\nOpening browser for Monzo authorization...'));
        const browserResult = await launchBrowser(actualAuthUrl);

        if (!browserResult.success) {
          console.log(chalk.yellow('\n⚠️  Could not open browser automatically'));
          console.log(chalk.yellow('Please open this URL in your browser:'));
          console.log(chalk.cyan(formatClickableUrl(actualAuthUrl)));
        }

        // Wait for callback
        spinner.start('Waiting for authorization (approve in Monzo app)...');
        callback = await server.waitForCallback();

        // Clean up server
        await server.shutdown();
      }

      // Handle OAuth errors
      if (callback.error) {
        spinner.fail('Authorization failed');
        throw new Error(
          `OAuth error: ${callback.error}${callback.errorDescription ? ' - ' + callback.errorDescription : ''}`
        );
      }

      // Validate state (CSRF protection)
      if (!callback.state || !this.validateState(state, callback.state)) {
        spinner.fail('Authorization failed');
        throw new Error('State parameter mismatch (possible CSRF attack)');
      }

      if (!callback.code) {
        spinner.fail('Authorization failed');
        throw new Error('No authorization code received');
      }

      // Exchange code for tokens
      spinner.start('Exchanging authorization code for tokens...');
      const tokenResponse = await this.apiClient.exchangeAuthorizationCode({
        code: callback.code,
        clientId: params.clientId,
        clientSecret: params.clientSecret,
        redirectUri,
      });

      const now = new Date();
      const expiresAt = new Date(now.getTime() + tokenResponse.expires_in * 1000);

      spinner.stop();

      return {
        clientId: params.clientId,
        clientSecret: params.clientSecret,
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        tokenExpiresAt: expiresAt.toISOString(),
        authorizedAt: now.toISOString(),
      };
    } catch (error) {
      spinner.stop();
      throw error;
    }
  }
}
