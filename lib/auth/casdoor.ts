import { SDK } from 'casdoor-nodejs-sdk';

const normalizeCert = (cert: string) => {
  if (!cert) return '';
  // If it already has newlines, assume it's correctly formatted
  if (cert.includes('\n')) return cert;
  
  const header = '-----BEGIN CERTIFICATE-----';
  const footer = '-----END CERTIFICATE-----';
  
  if (cert.startsWith(header) && cert.endsWith(footer)) {
    // Extract the base64 content between the header and footer
    const content = cert.substring(header.length, cert.length - footer.length).trim();
    // Return with proper PEM formatting (header, then content, then footer)
    return `${header}\n${content}\n${footer}`;
  }
  
  return cert;
};

export const casdoorConfig = {
  endpoint: process.env.CASDOOR_ENDPOINT || 'http://localhost:8000',
  clientId: process.env.CASDOOR_CLIENT_ID || '',
  clientSecret: process.env.CASDOOR_CLIENT_SECRET || '',
  certificate: normalizeCert(process.env.CASDOOR_CERTIFICATE || ''),
  orgName: process.env.CASDOOR_ORG_NAME || 'built-in',
  appName: process.env.CASDOOR_APP_NAME || 'app-built-in',
};

export const casdoorSDK = new SDK(casdoorConfig);

/**
 * OAuth redirect_uri and post-login redirects must use the URL users see in the browser.
 *
 * Detection priority:
 *  1. `x-forwarded-host` + `x-forwarded-proto` headers (Vercel / Nginx / Caddy proxies)
 *  2. `host` header (when not a loopback address)
 *  3. `APP_PUBLIC_URL` env var (manual override for edge cases)
 *  4. `request.url` (final fallback)
 *
 * For multi-domain deployments (e.g. multiple custom domains on Vercel pointing to the
 * same app), do NOT set APP_PUBLIC_URL — the origin will be derived dynamically from
 * each request's proxy headers, allowing correct per-domain OAuth redirect_uri.
 */
export function getPublicAppOrigin(request: Request): string {
  // 1. Proxy headers — most reliable on Vercel / behind reverse proxies
  const fwdHost = request.headers.get('x-forwarded-host');
  if (fwdHost) {
    const proto = request.headers.get('x-forwarded-proto') || 'https';
    return `${proto}://${fwdHost}`;
  }

  // 2. Host header — works for direct connections (not behind proxy)
  const host = request.headers.get('host');
  if (host && !/^(0\.0\.0\.0|127\.0\.0\.1|localhost)(:|$)/.test(host)) {
    const proto = request.url.startsWith('https') ? 'https' : 'http';
    return `${proto}://${host}`;
  }

  // 3. APP_PUBLIC_URL — manual single-domain override (bare Node.js deployments)
  const raw = process.env.APP_PUBLIC_URL?.trim();
  if (raw) {
    try {
      return new URL(raw).origin;
    } catch {
      // ignore invalid APP_PUBLIC_URL
    }
  }

  // 4. Final fallback
  return new URL(request.url).origin;
}
