# Environment Variables

All environment variables are read from a `.env` file (or the container environment) at startup. None are strictly required — the server will attempt sensible defaults where possible — but most features depend on them being set.

## Rhino Compute Connection

| Variable | Purpose | Default | Required |
|---|---|---|---|
| `RHINO_COMPUTE_URL` | Full URL (with trailing slash) of the Rhino Compute server the AppServer proxies solve requests to. Can also be set via the `--computeUrl` CLI argument. | `http://localhost:6500/` | Yes |
| `RHINO_COMPUTE_KEY` | API key passed in the `RhinoComputeKey` header on every request to the Compute server. Must match the key configured on the Compute side. | *(none)* | Yes |

## Azure Identity

These credentials allow the AppServer to start/stop an Azure VM running Rhino Compute. If omitted, the Azure VM management features are silently disabled and the server runs in "local/offline" mode.

| Variable | Purpose | Default | Required |
|---|---|---|---|
| `AZURE_TENANT_ID` | Azure AD tenant ID for the service principal. | *(none)* | For Azure VM management |
| `AZURE_CLIENT_ID` | Application (client) ID of the service principal. | *(none)* | For Azure VM management |
| `AZURE_CLIENT_SECRET` | Secret value for the service principal. | *(none)* | For Azure VM management |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription containing the Compute VM. | *(none)* | For Azure VM management |

## Azure Infrastructure

| Variable | Purpose | Default | Required |
|---|---|---|---|
| `AZURE_RESOURCE_GROUP` | Name of the Azure resource group that contains the VM. | *(none)* | For Azure VM management |
| `AZURE_VM_NAME` | Name of the Azure VM to start/stop/monitor. | *(none)* | For Azure VM management |

## Idle Shutdown & Watchdog

| Variable | Purpose | Default | Required |
|---|---|---|---|
| `IDLE_SHUTDOWN_LIMIT_MINUTES` | Number of minutes of inactivity before the watchdog deallocates the Azure VM. Set to `0` to disable automatic shutdown. | `30` | No |
| `IDLE_CHECK_INTERVAL_MS` | How often (in ms) the master process runs the idle-shutdown check. | `300000` (5 min) | No |

## Server

| Variable | Purpose | Default | Required |
|---|---|---|---|
| `PORT` | Port the HTTP server listens on. The Dockerfile sets this to `80`. | `3000` | No |
| `WEB_CONCURRENCY` | Number of worker processes spawned by `throng`. Each worker handles HTTP traffic independently. | `1` | No |
| `NODE_ENV` | Standard Node.js environment flag. When **not** `production`, HTTP request logging (`morgan`) is enabled. | *(none)* | No |

## Example `.env`

```env
# --- Rhino Compute Connection ---
RHINO_COMPUTE_URL=http://your-compute-server:80/
RHINO_COMPUTE_KEY=your-api-key-here

# --- Azure Identity ---
AZURE_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_CLIENT_SECRET=your-client-secret
AZURE_SUBSCRIPTION_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# --- Azure Infrastructure ---
AZURE_RESOURCE_GROUP=MyResourceGroup
AZURE_VM_NAME=MyComputeVM

# --- Idle Shutdown ---
IDLE_SHUTDOWN_LIMIT_MINUTES=30

# --- Server ---
PORT=80
```
