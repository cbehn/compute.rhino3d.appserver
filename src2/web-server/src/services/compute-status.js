/**
 * compute-status.js — Status & Health monitor for Rhino Compute.
 *
 * Provides status checks for the upstream Rhino Compute server in Google Cloud
 * or containerized environments. Replaces vendor-specific (Azure) VM controls
 * with cloud-agnostic HTTP health verification.
 */
const fetch = require('node-fetch');
const { getComputeHeaders } = require('../utils/gcp-auth');

class ComputeStatusService {
  constructor() {
    this.lastActivity = Date.now();
  }

  touchActivity() {
    this.lastActivity = Date.now();
  }

  getLastActivity() {
    return this.lastActivity;
  }

  /**
   * Check status of the Rhino Compute instance.
   * Returns compatibility response expected by ui-components.js showStartupOverlayAndWait():
   *  - { step: 3, status: 'live', message: 'Ready' }
   *  - { step: 2, status: 'starting', message: '...' }
   *  - { step: 1, status: 'offline', message: '...' }
   */
  async getWakeStatus() {
    const computeUrl = process.env.RHINO_COMPUTE_URL;
    const apiKey = process.env.RHINO_COMPUTE_KEY || '';

    if (!computeUrl) {
      return { step: 1, status: 'offline', message: 'RHINO_COMPUTE_URL is not configured' };
    }

    const base = computeUrl.endsWith('/') ? computeUrl : computeUrl + '/';
    const healthUrl = base + 'healthcheck';
    const versionUrl = base + 'version';

    try {
      const headers = await getComputeHeaders(healthUrl, apiKey);
      const healthRes = await fetch(healthUrl, {
        headers: headers,
        timeout: 4000
      });

      if (healthRes.ok) {
        try {
          const verHeaders = await getComputeHeaders(versionUrl, apiKey);
          const verRes = await fetch(versionUrl, {
            headers: verHeaders,
            timeout: 4000
          });
          if (verRes.ok) {
            return { step: 3, status: 'live', message: 'Ready' };
          }
          return { step: 3, status: 'live', message: 'Ready (healthcheck passed)' };
        } catch {
          // If version endpoint is slow but healthcheck passed, we consider it live
          return { step: 3, status: 'live', message: 'Ready' };
        }
      } else {
        return { step: 2, status: 'starting', message: `Compute warming up (status ${healthRes.status})...` };
      }
    } catch (err) {
      return {
        step: 2,
        status: 'starting',
        message: `Waiting for Rhino Compute (${err.code || err.message})...`
      };
    }
  }

  async checkHealth() {
    const computeUrl = process.env.RHINO_COMPUTE_URL;
    const apiKey = process.env.RHINO_COMPUTE_KEY || '';

    if (!computeUrl) {
      return { ok: false, error: 'RHINO_COMPUTE_URL not configured' };
    }

    const base = computeUrl.endsWith('/') ? computeUrl : computeUrl + '/';
    const url = base + 'healthcheck';

    try {
      const headers = await getComputeHeaders(url, apiKey);
      const res = await fetch(url, {
        headers: headers,
        timeout: 5000
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, body: text };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}

module.exports = new ComputeStatusService();
