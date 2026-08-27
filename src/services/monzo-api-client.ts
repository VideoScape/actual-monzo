/**
 * Monzo API Client
 * Handles HTTP requests to Monzo API endpoints
 */

import axios, { AxiosError } from 'axios';
import type { OAuthTokenResponse, WhoAmIResponse } from '../types/oauth.js';
import type { MonzoAccount, MonzoPot, MonzoTransaction } from '../types/monzo.js';

const MONZO_API_BASE = 'https://api.monzo.com';
// Monzo rejects transaction queries spanning more than 8,760 hours (one year).
// Stay below that ceiling so leap years and boundary rounding cannot exceed it.
const MONZO_TRANSACTION_RANGE_MS = 364 * 24 * 60 * 60 * 1000;

export interface TokenExchangeParams {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface TokenRefreshParams {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export class MonzoApiClient {
  /**
   * Validates Monzo access token by calling /ping/whoami
   */
  async whoami(accessToken: string): Promise<WhoAmIResponse> {
    try {
      const response = await axios.get<WhoAmIResponse>(`${MONZO_API_BASE}/ping/whoami`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        if (axiosError.response?.status === 401) {
          throw new Error('Invalid or expired access token');
        }
        throw new Error(`Monzo API error: ${axiosError.message}`);
      }
      throw error;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(params: TokenRefreshParams): Promise<OAuthTokenResponse> {
    try {
      const response = await axios.post<OAuthTokenResponse>(
        `${MONZO_API_BASE}/oauth2/token`,
        {
          grant_type: 'refresh_token',
          client_id: params.clientId,
          client_secret: params.clientSecret,
          refresh_token: params.refreshToken,
        },
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;

        // Handle OAuth error responses
        if (axiosError.response?.data) {
          const errorData = axiosError.response.data as { error?: string };
          if (errorData.error) {
            throw new Error(errorData.error);
          }
        }

        // Handle HTTP errors
        if (axiosError.response?.status === 400) {
          throw new Error('invalid_grant');
        }

        if (axiosError.response?.status === 401) {
          throw new Error('Invalid client credentials');
        }

        throw new Error(`Token refresh failed: ${axiosError.message}`);
      }

      throw error;
    }
  }

  /**
   * Exchanges authorization code for access and refresh tokens
   */
  async exchangeAuthorizationCode(params: TokenExchangeParams): Promise<OAuthTokenResponse> {
    try {
      const response = await axios.post<OAuthTokenResponse>(
        `${MONZO_API_BASE}/oauth2/token`,
        {
          grant_type: 'authorization_code',
          client_id: params.clientId,
          client_secret: params.clientSecret,
          code: params.code,
          redirect_uri: params.redirectUri,
        },
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;

        // Handle OAuth error responses
        if (axiosError.response?.data) {
          const errorData = axiosError.response.data as { error?: string };
          if (errorData.error) {
            throw new Error(errorData.error);
          }
        }

        // Handle HTTP errors
        if (axiosError.response?.status === 400) {
          throw new Error('invalid_grant');
        }

        if (axiosError.response?.status === 401) {
          throw new Error('Invalid client credentials');
        }

        throw new Error(`Token exchange failed: ${axiosError.message}`);
      }

      throw error;
    }
  }

  /**
   * Get all Monzo accounts for the authenticated user
   */
  async getAccounts(accessToken: string): Promise<MonzoAccount[]> {
    try {
      const response = await axios.get(`${MONZO_API_BASE}/accounts`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      return response.data.accounts ?? [];
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        if (axiosError.response?.status === 401) {
          throw new Error('Invalid or expired access token');
        }
        throw new Error(`Failed to fetch Monzo accounts: ${axiosError.message}`);
      }
      throw error;
    }
  }

  /**
   * Get every Pot belonging to a Monzo current account.
   * Deleted Pots are returned because historic transactions can still refer to them.
   */
  async getPots(currentAccountId: string, accessToken: string): Promise<MonzoPot[]> {
    try {
      const response = await axios.get(`${MONZO_API_BASE}/pots`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        params: {
          current_account_id: currentAccountId,
        },
      });

      return response.data.pots ?? [];
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        if (axiosError.response?.status === 401) {
          throw new Error('Invalid or expired access token');
        }
        throw new Error(`Failed to fetch Monzo Pots: ${axiosError.message}`);
      }
      throw error;
    }
  }

  /**
   * Get transactions for a Monzo account within a date range
   * Handles time-based pagination automatically and filters declined transactions
   *
   * Monzo API uses time-based pagination: when we get a full page (100 transactions),
   * we fetch the next page using the last transaction's timestamp as the new 'since' parameter.
   *
   * @param accountId Monzo account ID (format: acc_XXXXXXXX...)
   * @param since Start date (ISO 8601 timestamp)
   * @param before End date (ISO 8601 timestamp)
   * @param accessToken Monzo access token
   * @returns Array of valid (non-declined) transactions
   */
  async getTransactions(
    accountId: string,
    since: string,
    before: string,
    accessToken: string
  ): Promise<MonzoTransaction[]> {
    const allTransactions: MonzoTransaction[] = [];
    const maxRetries = 3;
    const pageLimit = 100;
    const rangeStart = new Date(since).getTime();
    const rangeEnd = new Date(before).getTime();

    if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeStart >= rangeEnd) {
      throw new Error('Invalid Monzo transaction date range');
    }

    for (
      let chunkStart = rangeStart;
      chunkStart < rangeEnd;
      chunkStart += MONZO_TRANSACTION_RANGE_MS
    ) {
      const chunkEnd = Math.min(chunkStart + MONZO_TRANSACTION_RANGE_MS, rangeEnd);
      let currentSince = new Date(chunkStart).toISOString();
      const currentBefore = new Date(chunkEnd).toISOString();
      let hasMorePages = true;
      let retryCount = 0;

      while (hasMorePages) {
        try {
          const params: Record<string, string | number> = {
            account_id: accountId,
            since: currentSince,
            before: currentBefore,
            'expand[]': 'merchant',
            limit: pageLimit,
          };

          const response = await axios.get(`${MONZO_API_BASE}/transactions`, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            params,
          });

          const transactions = response.data.transactions ?? [];
          allTransactions.push(...transactions);

          // A full page may have more results inside this date chunk.
          if (transactions.length === pageLimit) {
            const lastTransaction = transactions[transactions.length - 1];
            const nextSince = new Date(lastTransaction.created).getTime() + 1;
            hasMorePages = nextSince < chunkEnd;
            if (hasMorePages) currentSince = new Date(nextSince).toISOString();
          } else {
            hasMorePages = false;
          }

          retryCount = 0;
        } catch (error) {
          if (axios.isAxiosError(error)) {
            const axiosError = error as AxiosError;

            // Handle 401 Unauthorized - token expired
            if (axiosError.response?.status === 401) {
              throw new Error(
                'Monzo access token expired. Please re-authenticate:\n' + '  actual-monzo setup'
              );
            }

            // Handle 429 Rate Limit - exponential backoff
            if (axiosError.response?.status === 429) {
              if (retryCount < maxRetries) {
                const backoffDelay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
                await this.sleep(backoffDelay);
                retryCount++;
                continue; // Retry same request
              }
              throw new Error('Monzo API rate limit exceeded. Please try again later.');
            }

            // Handle 500 Server Error - single retry
            if (axiosError.response?.status === 500) {
              if (retryCount === 0) {
                await this.sleep(2000);
                retryCount++;
                continue; // Retry once
              }
              throw new Error('Monzo API is currently unavailable. Please try again later.');
            }

            throw new Error(`Monzo API error: ${axiosError.message}`);
          }

          throw error;
        }
      }
    }

    // Filter out declined transactions (decline_reason is only present when declined)
    const validTransactions = Array.from(
      new Map(
        allTransactions
          .filter(tx => !tx.decline_reason)
          .map(transaction => [transaction.id, transaction])
      ).values()
    );

    return validTransactions;
  }

  /**
   * Sleep utility for retry backoff
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
