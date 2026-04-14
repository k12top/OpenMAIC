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
 * If the process listens on 0.0.0.0 or a proxy sends a non-public Host, `request.url` can
 * become e.g. https://0.0.0.0:8080 — set APP_PUBLIC_URL to your real origin (no trailing slash).
 */
export function getPublicAppOrigin(request: Request): string {
  const raw = process.env.APP_PUBLIC_URL?.trim();
  if (raw) {
    try {
      return new URL(raw).origin;
    } catch {
      // ignore invalid APP_PUBLIC_URL
    }
  }
  return new URL(request.url).origin;
}
