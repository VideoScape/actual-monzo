/**
 * Pre-flight version check for Actual Budget server compatibility.
 *
 * Compares the installed @actual-app/api package version against the
 * server's reported version and warns or errors on major mismatches.
 */

import axios from 'axios';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

interface ServerInfo {
  build: {
    version: string;
    [key: string]: unknown;
  };
}

export interface VersionCheckResult {
  compatible: boolean;
  serverVersion: string | null;
  apiVersion: string;
  message?: string;
}

/**
 * Extract the major.minor portion of a version string (e.g. "25.9.0" → "25.9").
 * Actual Budget uses YY.MM versioning, so major.minor must match.
 */
function majorMinor(version: string): string {
  const parts = version.replace(/^v/, '').split('.');
  return `${parts[0]}.${parts[1]}`;
}

/**
 * Get the installed @actual-app/api package version by reading its package.json at runtime.
 */
function getApiVersion(): string {
  try {
    // Resolve from the dist directory where the bundle lives
    const distDir = dirname(fileURLToPath(import.meta.url));
    // Walk up to find node_modules relative to the package root
    const candidates = [
      join(distDir, '..', 'node_modules', '@actual-app', 'api', 'package.json'),
      join(distDir, 'node_modules', '@actual-app', 'api', 'package.json'),
    ];
    for (const candidate of candidates) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, 'utf-8'));
        return pkg.version;
      } catch {
        continue;
      }
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Query the Actual Budget server's /info endpoint for its version.
 */
async function getServerVersion(serverUrl: string): Promise<string | null> {
  try {
    const url = serverUrl.replace(/\/+$/, '') + '/info';
    const response = await axios.get<ServerInfo>(url, { timeout: 5000 });
    return response.data?.build?.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Check whether the installed @actual-app/api version is compatible
 * with the running Actual Budget server.
 *
 * Call this before `actualApi.init()` to surface a clear error message
 * instead of the cryptic empty errors the SDK throws on protocol mismatch.
 */
export async function checkServerCompatibility(serverUrl: string): Promise<VersionCheckResult> {
  const apiVersion = getApiVersion();
  const serverVersion = await getServerVersion(serverUrl);

  if (!serverVersion) {
    return {
      compatible: true, // can't check — proceed and let init() handle it
      serverVersion: null,
      apiVersion,
    };
  }

  if (apiVersion === 'unknown') {
    return {
      compatible: true, // can't check — proceed
      serverVersion,
      apiVersion,
    };
  }

  const serverMM = majorMinor(serverVersion);
  const apiMM = majorMinor(apiVersion);

  if (serverMM !== apiMM) {
    return {
      compatible: false,
      serverVersion,
      apiVersion,
      message:
        `Actual Budget version mismatch: server is v${serverVersion} but the installed ` +
        `@actual-app/api is v${apiVersion}.\n` +
        `The API client must match the server version. To fix:\n` +
        `  cd $(npm root -g)/actual-monzo && npm install @actual-app/api@${serverVersion}`,
    };
  }

  return {
    compatible: true,
    serverVersion,
    apiVersion,
  };
}
