/**
 * utils/gcp-auth.js — GCP Cloud Run Service-to-Service Authentication.
 *
 * Acquires Google-signed OIDC ID tokens via the GCP Metadata Server
 * when running inside Cloud Run, enabling secure calls to private services.
 * In local development, gracefully skips OIDC tokens.
 */
const fetch = require('node-fetch');

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Obtain an OIDC ID token for the given target audience.
 * @param {string} targetUrl The target service URL (e.g. https://rhino-compute-linux-xxx.run.app)
 * @returns {Promise<string|null>} The Bearer ID token or null
 */
async function getIdToken(targetUrl) {
  // If target is localhost or HTTP (not HTTPS), skip GCP IAM token
  if (!targetUrl || targetUrl.startsWith('http://localhost') || targetUrl.startsWith('http://127.0.0.1')) {
    return null;
  }

  // Check cache (refresh 5 minutes before expiry)
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 300000) {
    return cachedToken;
  }

  try {
    const audience = new URL(targetUrl).origin;
    const metadataUrl = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(metadataUrl, {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const token = (await res.text()).trim();
      cachedToken = token;
      // Default GCP ID token validity is 1 hour
      tokenExpiresAt = now + 3600000;
      return token;
    }
  } catch (err) {
    // Expected when running locally outside GCP
  }

  return null;
}

/**
 * Returns authorization headers including GCP Bearer token (if on GCP)
 * and RhinoComputeKey.
 * @param {string} targetUrl
 * @param {string} [apiKey]
 * @returns {Promise<Object>}
 */
async function getComputeHeaders(targetUrl, apiKey) {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (apiKey) {
    headers['RhinoComputeKey'] = apiKey;
  }

  const idToken = await getIdToken(targetUrl);
  if (idToken) {
    headers['Authorization'] = `Bearer ${idToken}`;
  }

  return headers;
}

module.exports = {
  getIdToken,
  getComputeHeaders
};
