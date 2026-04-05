/**
 * OAuth Callback Server
 * Temporary HTTP server for receiving OAuth authorization callbacks
 */

import http from 'http';
import { URL } from 'url';

export interface OAuthCallbackResult {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

export interface OAuthServer {
  start: () => Promise<number>;
  waitForCallback: () => Promise<OAuthCallbackResult>;
  shutdown: () => Promise<void>;
}

/**
 * Gets the OAuth callback port from environment or default
 * Validates that the port is within valid range (1-65535)
 */
export function getOAuthCallbackPort(): number {
  const DEFAULT_PORT = 8234;
  const envPort = process.env.OAUTH_CALLBACK_PORT;

  if (!envPort) {
    return DEFAULT_PORT;
  }

  const port = parseInt(envPort, 10);

  // Validate port is a valid number and within valid range
  if (isNaN(port) || port < 1 || port > 65535) {
    console.warn(
      `Invalid OAUTH_CALLBACK_PORT "${envPort}", falling back to default ${DEFAULT_PORT}`
    );
    return DEFAULT_PORT;
  }

  return port;
}

/**
 * Creates a temporary OAuth callback server
 * Port can be configured via OAUTH_CALLBACK_PORT environment variable (default: 8234)
 * Listens on localhost only
 */
export async function createOAuthCallbackServer(): Promise<OAuthServer> {
  const port = getOAuthCallbackPort();
  let server: http.Server | null = null;
  let actualPort: number = port;
  let callbackResolver: ((result: OAuthCallbackResult) => void) | null = null;

  const requestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    // Only handle /callback route
    if (!req.url?.startsWith('/callback')) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>404 Not Found</h1></body></html>');
      return;
    }

    // Parse query parameters
    const url = new URL(req.url, `http://localhost:${actualPort}`);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const errorDescription = url.searchParams.get('error_description');

    // Send success page to browser
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (error) {
      res.end(`
        <html>
          <head>
            <meta charset="utf-8">
            <title>Authorization Failed</title>
          </head>
          <body style="font-family: sans-serif; padding: 40px; text-align: center;">
            <h1 style="color: #d32f2f;">❌ Authorization Failed</h1>
            <p>Error: ${error}</p>
            ${errorDescription ? `<p>${errorDescription}</p>` : ''}
            <p>You can close this window and return to the terminal.</p>
          </body>
        </html>
      `);
    } else {
      res.end(`
        <html>
          <head>
            <meta charset="utf-8">
            <title>Authorization Successful</title>
          </head>
          <body style="font-family: sans-serif; padding: 40px; text-align: center;">
            <h1 style="color: #4caf50;">✓ Authorization Successful</h1>
            <p>You can close this window and return to the terminal.</p>
          </body>
        </html>
      `);
    }

    // Resolve with callback result
    if (callbackResolver) {
      callbackResolver({
        code: code ?? undefined,
        state: state ?? undefined,
        error: error ?? undefined,
        errorDescription: errorDescription ?? undefined,
      });
      callbackResolver = null;
    }
  };

  const start = async (): Promise<number> => {
    try {
      await new Promise<void>((resolve, reject) => {
        server = http.createServer(requestHandler);

        server.on('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            reject(new Error(`Port ${port} is already in use`));
          } else {
            reject(err);
          }
        });

        server.listen(port, 'localhost', () => {
          actualPort = port;
          resolve();
        });
      });

      return actualPort;
    } catch (error) {
      throw new Error(
        `Port ${port} is already in use. ` +
          `Please free up the port or check if another OAuth flow is running.\n` +
          `Run: lsof -i :${port} to see what's using the port.`
      );
    }
  };

  const waitForCallback = (): Promise<OAuthCallbackResult> => {
    return new Promise(resolve => {
      callbackResolver = resolve;
    });
  };

  const shutdown = async (): Promise<void> => {
    if (server) {
      return new Promise((resolve, reject) => {
        server!.close(err => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  };

  return { start, waitForCallback, shutdown };
}
