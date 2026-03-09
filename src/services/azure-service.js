/**
 * azure-service.js — Azure VM power-management service.
 *
 * Manages the lifecycle of the Azure VM running Rhino Compute. Provides
 * methods to start the VM, check its status (multi-step: Azure → healthcheck
 * → version), and automatically deallocate it after a configurable idle
 * period to save costs.
 *
 * Key features:
 *  - File-based activity heartbeat (.last_activity) shared across workers
 *  - Lazy-loaded Azure client (gracefully degrades if env vars are missing)
 *  - Multi-step wake-status check (VM power state → /healthcheck → /version)
 *  - Idle watchdog (checkIdleAndShutdown) run by the master process
 *
 * Exports a singleton AzureService instance.
 */
const { ComputeManagementClient } = require("@azure/arm-compute");
const { DefaultAzureCredential } = require("@azure/identity");
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Configuration
const AZURE_SUB_ID = process.env.AZURE_SUBSCRIPTION_ID;
const AZURE_RG = process.env.AZURE_RESOURCE_GROUP;
const AZURE_VM = process.env.AZURE_VM_NAME;
const IDLE_LIMIT_MS = process.env.IDLE_SHUTDOWN_LIMIT_MINUTES * 60 * 1000 || 30 * 60 * 1000; // default to 30 minutes
const ACTIVITY_FILE = path.join(__dirname, '../.last_activity');

class AzureService {
  constructor() {
    this.computeClient = null;
    this.isVmActionInProgress = false;

    // Initialize activity file if missing
    this.touchActivity();
  }

  // Lazy-load the Azure client to prevent crashes if env vars are missing at startup
  _getClient() {
    if (!this.computeClient) {
      if (!AZURE_SUB_ID || !AZURE_RG || !AZURE_VM) {
        // Return null if not configured, allows running in local/offline mode
        return null;
      }
      const credential = new DefaultAzureCredential();
      this.computeClient = new ComputeManagementClient(credential, AZURE_SUB_ID);
    }
    return this.computeClient;
  }

  // --- Shared File-Based Heartbeat ---

  // Update the file timestamp to "now"
  touchActivity() {
    try {
      const time = Date.now().toString();
      fs.writeFileSync(ACTIVITY_FILE, time, 'utf8');
    } catch (err) {
      console.error("Error updating activity file:", err);
    }
  }

  // Read the timestamp (returns ms since epoch)
  getLastActivity() {
    try {
      if (!fs.existsSync(ACTIVITY_FILE)) return Date.now(); // Default to now if missing
      const content = fs.readFileSync(ACTIVITY_FILE, 'utf8');
      return parseInt(content, 10) || Date.now();
    } catch (err) {
      console.error("Error reading activity file:", err);
      return Date.now(); // Fail safe to "active"
    }
  }

  // Bump the "last active" timestamp so the watchdog knows we are busy
  keepAlive() {
    this.touchActivity();
  }

  // --- VM Management ---

  async startVM() {
    const client = this._getClient();
    if (!client) {
      throw new Error("Azure environment variables not set.");
    }

    // Avoid spamming start commands if we are locally tracking an action
    if (this.isVmActionInProgress) {
      return { status: 202, message: "VM action already in progress." };
    }

    try {
      // Check actual status from Azure before deciding
      const instanceView = await client.virtualMachines.instanceView(AZURE_RG, AZURE_VM);
      const statuses = instanceView.statuses || [];
      const isRunning = statuses.some(s => s.code && s.code.includes("PowerState/running"));
      const isStarting = statuses.some(s => s.code && s.code.includes("PowerState/starting"));

      if (isRunning || isStarting) {
        return { status: 200, message: "VM is already running or starting." };
      }

      this.isVmActionInProgress = true;
      console.log(`Starting Azure VM: ${AZURE_VM}...`);

      // We use beginStart but don't wait for completion so the UI can poll health check
      // catch error here to prevent unhandled promise rejection if we don't await
      client.virtualMachines.beginStart(AZURE_RG, AZURE_VM).catch(err => {
        console.error("Async start error:", err);
      });

      // Reset flag after delay to allow retries
      setTimeout(() => { this.isVmActionInProgress = false; }, 10000);

      return { status: 200, message: "Start command sent." };

    } catch (err) {
      console.error("Failed to start VM:", err);
      this.isVmActionInProgress = false;
      throw err;
    }
  }

  async getWakeStatus() {
    // defaults
    let result = { step: 0, status: 'offline', message: 'Checking status...' };

    // STEP 1: Check Azure
    const client = this._getClient();
    if (client) {
      try {
        const instanceView = await client.virtualMachines.instanceView(AZURE_RG, AZURE_VM);
        const statuses = instanceView.statuses || [];
        const isRunning = statuses.some(s => s.code && s.code.includes("PowerState/running"));
        const isStarting = statuses.some(s => s.code && s.code.includes("PowerState/starting"));

        if (isStarting) {
          return { step: 1, status: 'starting', message: 'VM is warming up...' };
        }
        if (!isRunning) {
          return { step: 1, status: 'offline', message: 'VM is offline' };
        }
        // If running, proceed to step 2
      } catch (err) {
        console.error("Azure Status Check Failed:", err.message);
        return { step: 1, status: 'offline', message: 'Status check failed: ' + err.message };
      }
    }

    // STEP 2: Check /healthcheck
    const computeUrl = process.env.RHINO_COMPUTE_URL;
    const apiKey = process.env.RHINO_COMPUTE_KEY;

    if (!computeUrl) {
      return { step: 2, status: 'offline', message: 'Compute URL not configured' };
    }

    const healthUrl = computeUrl.endsWith('/') ? computeUrl + 'healthcheck' : computeUrl + '/healthcheck';
    const versionUrl = computeUrl.endsWith('/') ? computeUrl + 'version' : computeUrl + '/version';

    try {
      const healthRes = await fetch(healthUrl, { headers: { 'RhinoComputeKey': apiKey }, timeout: 2000 });
      if (healthRes.ok) {
        // STEP 3: Check /version
        try {
          const verRes = await fetch(versionUrl, { headers: { 'RhinoComputeKey': apiKey }, timeout: 2000 });
          if (verRes.ok) {
            return { step: 3, status: 'live', message: 'Ready' };
          } else {
            return { step: 3, status: 'starting', message: 'Service up, verifying version...' };
          }
        } catch (err) {
          return { step: 3, status: 'starting', message: 'Service up, checking version...' };
        }
      } else {
        return { step: 2, status: 'starting', message: 'VM running, waiting for service...' };
      }
    } catch (err) {
      return { step: 2, status: 'starting', message: 'VM running, waiting for connection...' };
    }
  }

  // Periodically check if the server has been idle too long
  async checkIdleAndShutdown() {
    const lastActivity = this.getLastActivity();
    const timeSince = Date.now() - lastActivity;

    if (timeSince > IDLE_LIMIT_MS && !this.isVmActionInProgress && IDLE_LIMIT_MS !== 0) {
      console.log(`[Watchdog] Idle for ${Math.floor(timeSince / 60000)}m. Checking status...`);
      const client = this._getClient();

      if (client) {
        try {
          // Verify it's running before trying to stop it
          const instanceView = await client.virtualMachines.instanceView(AZURE_RG, AZURE_VM);
          const isRunning = instanceView.statuses.some(s => s.code && s.code.includes("PowerState/running"));

          if (isRunning) {
            console.log("[Watchdog] Stopping VM to save costs...");
            this.isVmActionInProgress = true;
            // beginDeallocate stops billing; beginPowerOff does not.
            await client.virtualMachines.beginDeallocate(AZURE_RG, AZURE_VM);
            console.log("VM Deallocation initiated.");
          } else {
            console.log("[Watchdog] VM is not running. No action taken.");
          }
        } catch (err) {
          console.error("[Watchdog] Error during shutdown check:", err.message);
        } finally {
          this.isVmActionInProgress = false;
        }
      } else {
        console.log("[Watchdog] Azure client not configured. Skipping shutdown check.");
      }
    }
  }
}

module.exports = new AzureService();