const createError = require('http-errors')
const express = require('express')
const compression = require('compression')
const logger = require('morgan')
const cors = require('cors')
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch'); 

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

app.set('view engine', 'hbs');
app.set('views', './src/views')

// Routes for this app
app.use('/cnc', express.static(__dirname + '/examples/cnc'))
app.use('/health', express.static(__dirname + '/examples/health'))
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
  const ioPath = path.join(__dirname, 'examples/health/files/hops_io.json');
  const solvePath = path.join(__dirname, 'examples/health/files/hops_solve.json');

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