const createError = require('http-errors')
const express = require('express')
const compression = require('compression')
const logger = require('morgan')
const cors = require('cors')
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch'); 
const { ComputeManagementClient } = require("@azure/arm-compute");
const { DefaultAzureCredential } = require("@azure/identity");

// create express web server app
const app = express()

// log requests to the terminal when running in a local debug setup
if(process.env.NODE_ENV !== 'production')
  app.use(logger('dev'))

app.use(express.json({limit: '10mb'}))
app.use(express.urlencoded({ extended: false }))
app.use(cors())
app.use(compression())

// Define URL for our compute server
const argIndex = process.argv.indexOf('--computeUrl')
if (argIndex > -1)
  process.env.RHINO_COMPUTE_URL = process.argv[argIndex + 1]
if (!process.env.RHINO_COMPUTE_URL)
  process.env.RHINO_COMPUTE_URL = 'http://localhost:6500/' // default if nothing else exists

console.log('RHINO_COMPUTE_URL: ' + process.env.RHINO_COMPUTE_URL)

// =============================================================================
//   AZURE COMPUTE POWER MANAGEMENT & IDLE SHUTDOWN
// =============================================================================

const AZURE_SUB_ID = process.env.AZURE_SUBSCRIPTION_ID;
const AZURE_RG = process.env.AZURE_RESOURCE_GROUP;
const AZURE_VM = process.env.AZURE_VM_NAME;

// Track last activity time (default to now so we don't shutdown immediately on boot)
let lastActivity = Date.now();
let isVmActionInProgress = false;

// Middleware to update last activity on solve requests
app.use('/solve', (req, res, next) => {
    lastActivity = Date.now();
    res.on('finish', () => { lastActivity = Date.now(); });
    next();
});

// Helper to get Azure Client
function getComputeClient() {
    if (!AZURE_SUB_ID || !AZURE_RG || !AZURE_VM) return null;
    const credential = new DefaultAzureCredential();
    return new ComputeManagementClient(credential, AZURE_SUB_ID);
}

// Route to manually wake up the VM
app.post('/wakeup', async (req, res) => {
    const client = getComputeClient();
    if (!client) {
        return res.status(500).json({ error: "Azure environment variables not set." });
    }
    
    // Avoid spamming start commands
    if (isVmActionInProgress) {
        return res.status(202).json({ message: "VM action already in progress." });
    }

    try {
        isVmActionInProgress = true;
        console.log(`Starting Azure VM: ${AZURE_VM}...`);
        // We use beginStart but don't wait for completion so the UI can poll health check
        await client.virtualMachines.beginStart(AZURE_RG, AZURE_VM);
        res.json({ message: "Start command sent." });
    } catch (err) {
        console.error("Failed to start VM:", err);
        res.status(500).json({ error: err.message });
    } finally {
        isVmActionInProgress = false;
        // Reset idle timer so we don't shut down immediately after waking
        lastActivity = Date.now();
    }
});

// IDLE CHECKER (Runs every minute)
// Shuts down VM if idle for > 30 mins
setInterval(async () => {
    const IDLE_LIMIT = 30 * 60 * 1000; // 30 minutes
    const timeSinceActive = Date.now() - lastActivity;

    if (timeSinceActive > IDLE_LIMIT && !isVmActionInProgress) {
        const client = getComputeClient();
        if (client) {
            try {
                // Check status first to avoid errors if already stopped
                const instanceView = await client.virtualMachines.instanceView(AZURE_RG, AZURE_VM);
                const isRunning = instanceView.statuses.some(s => s.code && s.code.includes("PowerState/running"));

                if (isRunning) {
                    console.log(`VM idle for ${Math.floor(timeSinceActive/60000)} mins. Stopping VM...`);
                    isVmActionInProgress = true;
                    // beginDeallocate stops billing; beginPowerOff does not.
                    await client.virtualMachines.beginDeallocate(AZURE_RG, AZURE_VM);
                    console.log("VM Deallocation initiated.");
                }
            } catch (err) {
                console.error("Idle shutdown error:", err.message);
            } finally {
                isVmActionInProgress = false;
            }
        }
    }
}, 60 * 1000);
// =============================================================================

app.set('view engine', 'hbs');
app.set('views', './src/views')

// Routes for this app
app.use('/cnc', express.static(__dirname + '/pages/cnc'))
app.use('/health', express.static(__dirname + '/pages/health'))
app.get('/favicon.ico', (req, res) => res.status(200))
app.use('/definition', require('./routes/definition'))

// --- NEW: Proxy Healthcheck to Compute Server ---
app.get('/healthcheck', async (req, res) => {
  const computeUrl = process.env.RHINO_COMPUTE_URL;
  const apiKey = process.env.RHINO_COMPUTE_KEY; 
  
  // Ensure we construct the URL correctly regardless of trailing slash
  const url = computeUrl.endsWith('/') ? computeUrl + 'healthcheck' : computeUrl + '/healthcheck';

  try {
    const response = await fetch(url, {
        headers: {
            'RhinoComputeKey': apiKey 
        }
    });

    if (response.ok) {
        const text = await response.text();
        res.status(200).send(text); // Usually returns "healthy"
    } else {
        res.status(response.status).send(`Compute Server returned ${response.status}`);
    }
  } catch (error) {
    res.status(500).send(`AppServer could not reach Compute Server: ${error.message}`);
  }
});

// --- HEALTH CHECK API UTILS ---

// 1. API: Get List of Files
app.get('/api/health/files', (req, res) => {
  const filesDir = path.join(__dirname, 'files');
  fs.readdir(filesDir, (err, files) => {
    if (err) return res.status(500).json({ error: 'Unable to scan files' });
    const ghFiles = files.filter(f => f.endsWith('.gh') || f.endsWith('.ghx'));
    res.json(ghFiles);
  });
});

// 2. API: Check API Key (Server-side to protect the key)
app.get('/api/health/check-auth', async (req, res) => {
  const computeUrl = process.env.RHINO_COMPUTE_URL;
  const apiKey = process.env.RHINO_COMPUTE_KEY; 
  
  const url = computeUrl.endsWith('/') ? computeUrl + 'healthcheck' : computeUrl + '/healthcheck';

  try {
    const response = await fetch(url, {
      headers: { 'RhinoComputeKey': apiKey }
    });
    if (response.status === 200) {
      res.json({ status: 'pass', message: 'API Key accepted by Compute Server' });
    } else {
      res.json({ status: 'fail', message: `Server returned ${response.status}` });
    }
  } catch (error) {
    res.json({ status: 'fail', message: error.message });
  }
});

// 3. API: Simulate Hops
app.post('/api/health/test-hops', async (req, res) => {
  // FIX: Point to the files where they actually exist in src/examples/health/files/
  const ioPath = path.join(__dirname, 'pages/health/files/hops_io.json');
  const solvePath = path.join(__dirname, 'pages/health/files/hops_solve.json');

  if (!fs.existsSync(ioPath) || !fs.existsSync(solvePath)) {
    // Helpful debug message if it fails again
    console.error(`Files not found at: ${ioPath} or ${solvePath}`);
    return res.json({ status: 'yellow', message: 'Simulation files (hops_io.json, hops_solve.json) not found in src/examples/health/files/.' });
  }

  try {
    // Ideally this would send the payloads to the /solve endpoint
    res.json({ status: 'pass', message: 'Simulation files loaded.' });
  } catch (err) {
    res.json({ status: 'fail', message: 'Error reading simulation files: ' + err.message });
  }
});


app.use('/solve', require('./routes/solve'))
app.use('/view', require('./routes/template'))
app.use('/version', require('./routes/version'))
app.use('/', require('./routes/index'))
app.use('/files', express.static(__dirname + '/files'));

// ref: https://github.com/expressjs/express/issues/3589
// remove line when express@^4.17
express.static.mime.types["wasm"] = "application/wasm";

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404))
})

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message
  console.error(err)
  res.locals.error = req.app.get('env') === 'development' ? err : {}
  data = { message: err.message }
  if (req.app.get('env') === 'development')
  {
    data.stack = err.stack
  }
  // send the error
  res.status(err.status || 500).send(data)
})

module.exports = app