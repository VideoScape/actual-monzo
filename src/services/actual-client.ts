/**
 * Actual Budget Client
 * Validates connection to Actual Budget server
 */

import * as actualApi from '@actual-app/api';
import { SetupErrorCode } from '../types/setup';
import * as fs from 'fs/promises';
import * as path from 'path';
import { suppressConsole } from '../utils/cli-utils.js';
import { checkServerCompatibility } from '../utils/actual-version-check.js';

export interface ConnectionValidationResult {
  success: boolean;
  validatedAt?: string;
  error?: {
    code: SetupErrorCode;
    message: string;
    originalError?: Error;
  };
}

export class ActualClient {
  /**
   * Resolves data directory path, expanding ~ and relative paths
   */
  private resolveDataDirectory(dataDir: string): string {
    // Expand tilde
    if (dataDir.startsWith('~')) {
      return dataDir.replace('~', process.env.HOME ?? '');
    }

    // Resolve relative paths to absolute
    if (dataDir.startsWith('.')) {
      return path.resolve(process.cwd(), dataDir);
    }

    return dataDir;
  }

  /**
   * Validates connection to Actual Budget server
   * Tests credentials by calling actual.init() then disconnects
   * Creates data directory if it doesn't exist
   */
  async validateConnection(
    serverUrl: string,
    password: string,
    dataDirectory: string
  ): Promise<ConnectionValidationResult> {
    try {
      // Resolve data directory path
      const resolvedDataDir = this.resolveDataDirectory(dataDirectory);

      // Create data directory if it doesn't exist
      try {
        await fs.mkdir(resolvedDataDir, { recursive: true });
      } catch (mkdirError) {
        return {
          success: false,
          error: {
            code: SetupErrorCode.DIRECTORY_ERROR,
            message:
              `Cannot create data directory ${resolvedDataDir}.\n` +
              'Please check:\n' +
              `  - You have write permissions\n` +
              `  - Parent directory exists\n` +
              `  - Disk space is available`,
            originalError: mkdirError instanceof Error ? mkdirError : new Error(String(mkdirError)),
          },
        };
      }

      // Pre-flight version compatibility check
      const versionCheck = await checkServerCompatibility(serverUrl);
      if (!versionCheck.compatible) {
        return {
          success: false,
          error: {
            code: SetupErrorCode.CONFIGURATION_ERROR,
            message: versionCheck.message!,
          },
        };
      }

      // Attempt to initialize Actual Budget SDK
      await actualApi.init({
        serverURL: serverUrl,
        password,
        dataDir: resolvedDataDir,
      });

      // Success - connection validated
      const validatedAt = new Date().toISOString();

      return {
        success: true,
        validatedAt,
      };
    } catch (error) {
      const err = error as Error & { code?: string; status?: number };

      // Categorize error types
      if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
        return {
          success: false,
          error: {
            code: SetupErrorCode.SERVER_UNREACHABLE,
            message:
              `Cannot reach Actual Budget server at ${serverUrl}. Please check:\n` +
              `  - Server is running\n` +
              `  - URL is correct\n` +
              `  - No firewall blocking connection`,
            originalError: err,
          },
        };
      }

      if (err.code === 'ETIMEDOUT' || err.message?.includes('timeout')) {
        return {
          success: false,
          error: {
            code: SetupErrorCode.SERVER_UNREACHABLE,
            message:
              `Actual Budget server is not responding at ${serverUrl}. Please check:\n` +
              `  - Server is running and accessible\n` +
              `  - Network connection is stable\n` +
              `  - Server is not overloaded`,
            originalError: err,
          },
        };
      }

      if (err.code === 'ENOTFOUND' || err.message?.includes('ENOTFOUND')) {
        return {
          success: false,
          error: {
            code: SetupErrorCode.SERVER_UNREACHABLE,
            message:
              `Cannot reach Actual Budget server at ${serverUrl}. Please check:\n` +
              `  - Server URL hostname is correct\n` +
              `  - DNS resolution is working\n` +
              `  - Server is accessible from this network`,
            originalError: err,
          },
        };
      }

      if (
        err.status === 401 ||
        err.message?.includes('401') ||
        err.message?.includes('Unauthorized')
      ) {
        return {
          success: false,
          error: {
            code: SetupErrorCode.INVALID_CREDENTIALS,
            message:
              'Invalid password for Actual Budget server.\n' + 'Please check your server password.',
            originalError: err,
          },
        };
      }

      if (
        err.code === 'EACCES' ||
        err.code === 'EPERM' ||
        err.message?.includes('permission denied')
      ) {
        return {
          success: false,
          error: {
            code: SetupErrorCode.DIRECTORY_ERROR,
            message:
              `Cannot write to directory ${dataDirectory}.\n` +
              'Please check:\n' +
              `  - Directory exists or can be created\n` +
              `  - You have write permissions\n` +
              `  - Disk space is available`,
            originalError: err,
          },
        };
      }

      // Unknown error
      return {
        success: false,
        error: {
          code: SetupErrorCode.CONFIGURATION_ERROR,
          message: `Unexpected error connecting to Actual Budget: ${err.message ?? 'Unknown error'}`,
          originalError: err,
        },
      };
    } finally {
      // Always disconnect, even on error
      // Suppress console output during shutdown to hide Actual Budget API's internal errors
      await suppressConsole(async () => {
        try {
          if (typeof actualApi.shutdown === 'function') {
            await actualApi.shutdown();
          }
        } catch (shutdownError) {
          // Ignore disconnect errors - Actual Budget API sometimes throws
          // "Cannot read properties of undefined (reading 'timestamp')" during shutdown
          // This is a known issue in @actual-app/api and can be safely ignored
        }
      });
    }
  }
}
