const { ComputeManagementClient } = require("@azure/arm-compute");
const { DefaultAzureCredential } = require("@azure/identity");
const memjs = require('memjs');
const fetch = require('node-fetch');

// Configuration
const AZURE_SUB_ID = process.env.AZURE_SUBSCRIPTION_ID;
const AZURE_RG = process.env.AZURE_RESOURCE_GROUP;
const AZURE_VM = process.env.AZURE_VM_NAME;
const REDIS_KEY_LAST_ACTIVITY = 'compute:last-activity';
const IDLE_LIMIT_MS = 30 * 60 * 1000; // 30 minutes

class AzureService {
  constructor() {
    // Use Redis to share state across all worker processes
    this.cache = memjs.Client.create(process.env.MEMCACHIER_SERVERS, {
      failover: true,
      timeout: 1,
      keepAlive: true
    });

    this.computeClient = null;
  }

  // Lazy-load the Azure client to prevent crashes if env vars are missing at startup
  _getClient() {
    if (!this.computeClient) {
      if (!AZURE_SUB_ID || !AZURE_RG || !AZURE_VM) {
        throw new Error('Azure environment variables missing.');
      }
      const credential = new DefaultAzureCredential();
      this.computeClient = new ComputeManagementClient(credential, AZURE_SUB_ID);
    }
    return this.computeClient;
  }

  // Bump the "last active" timestamp so the watchdog knows we are busy
  async keepAlive() {
    await this.cache.set(REDIS_KEY_LAST_ACTIVITY, Date.now().toString(), { expires: IDLE_LIMIT_MS / 1000 + 600 });
  }

  /**
   * Ensure the backend is ready.
   * Returns 'running' if ready, or 'starting' if we had to wake it up.
   */
  async ensureRunning() {
    // 1. Fast Check: Ping the application directly
    try {
      let computeUrl = process.env.RHINO_COMPUTE_URL;
      if (!computeUrl.endsWith('/')) computeUrl += '/';
      
      const healthUrl = computeUrl + 'healthcheck';
      const apiKey = process.env.RHINO_COMPUTE_KEY;

      // Use a short timeout; if it hangs, assume the server is down
      const res = await fetch(healthUrl, {
        headers: { 'RhinoComputeKey': apiKey },
        timeout: 2000 
      });

      if (res.ok) {
        await this.keepAlive();
        return "running";
      }
    } catch (err) {
      // Ignore network errors; proceed to check infrastructure
    }

    // 2. Slow Check: Ask Azure if the VM is actually on
    console.log("Service not responding. Checking Azure VM status...");
    const client = this._getClient();
    
    let instanceView;
    try {
        instanceView = await client.virtualMachines.instanceView(AZURE_RG, AZURE_VM);
    } catch (err) {
        console.error("Azure API failed:", err.message);
        throw err;
    }

    const isRunning = instanceView.statuses.some(s => s.code && s.code.includes("PowerState/running"));
    const isStarting = instanceView.statuses.some(s => s.code && s.code.includes("PowerState/starting"));

    // If Azure says "Running" but the Fast Check failed, Rhino.Compute.exe is likely still booting
    if (isRunning || isStarting) {
        console.log("VM is active but service is not ready. Waiting...");
        return "starting";
    }

    // 3. Recovery: VM is stopped or evicted, so we start it
    console.log("VM is stopped. Sending start command...");
    try {
        await client.virtualMachines.beginStart(AZURE_RG, AZURE_VM);
        return "starting";
    } catch (err) {
        // Handle Spot Instance capacity errors gracefully
        if (err.message && err.message.includes('OverconstrainedAllocationRequest')) {
            throw new Error("Spot VM capacity unavailable. Please try again later.");
        }
        throw err;
    }
  }

  // Periodically check if the server has been idle too long
  async checkIdleAndShutdown() {
    const { value } = await this.cache.get(REDIS_KEY_LAST_ACTIVITY);
    const lastActivity = value ? parseInt(value.toString()) : Date.now();
    const timeSince = Date.now() - lastActivity;

    if (timeSince > IDLE_LIMIT_MS) {
        console.log(`[Watchdog] Idle for ${Math.floor(timeSince/60000)}m. Checking status...`);
        const client = this._getClient();

        try {
            // Verify it's running before trying to stop it
            const instanceView = await client.virtualMachines.instanceView(AZURE_RG, AZURE_VM);
            const isRunning = instanceView.statuses.some(s => s.code && s.code.includes("PowerState/running"));

            if (isRunning) {
                console.log("[Watchdog] Stopping VM to save costs...");
                await client.virtualMachines.beginDeallocate(AZURE_RG, AZURE_VM);
            }
        } catch (err) {
            console.error("[Watchdog] Error during shutdown check:", err.message);
        }
    }
  }
}

module.exports = new AzureService();