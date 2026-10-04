/**
 * server.js — Main Express entry point for the CNC Web Container.
 *
 * Designed for deployment on Google Cloud Run, GKE, or local Docker.
 * Serves the CoLab CNC Setup Tool and provides proxy endpoints to Rhino Compute.
 */
const express = require('express');
const path = require('path');
const cors = require('cors');
const compression = require('compression');
const logger = require('morgan');
const { registerDefinitions } = require('./definitions');

const app = express();
const PORT = process.env.PORT || 8080;

// Logging & Performance
if (process.env.NODE_ENV !== 'production') {
  app.use(logger('dev'));
}
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: false, limit: '25mb' }));
app.use(cors());
app.use(compression());

// Pre-load Grasshopper definitions
const definitions = registerDefinitions();
app.set('definitions', definitions);
console.log(`[server] Registered ${definitions.length} CNC definitions:`, definitions.map(d => d.name));

// Google Cloud Container Health Probe
app.get(['/health', '/healthz'], (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Favicon
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/favicon.ico'));
});

// Shared static UI assets (daisy themes, loading phrases, ui-components.js)
app.use('/public', express.static(path.join(__dirname, '../public')));

// CNC tool static assets (HTML, script.js, style.css, files)
app.use('/cnc', express.static(path.join(__dirname, '../cnc')));
app.use('/cnc/files', express.static(path.join(__dirname, '../cnc/files')));

// Serve CNC page at root URL '/' as the default MVP view
app.use(express.static(path.join(__dirname, '../cnc')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../cnc/index.html'));
});

// Mount API routes
app.use('/api', require('./routes/api'));
app.use('/solve', require('./routes/solve'));
app.use('/definition', require('./routes/definition'));

// Mount wakeStatus & wakeup at root for frontend compatibility
const apiRoutes = require('./routes/api');
app.get('/wakeStatus', apiRoutes);
app.post('/wakeup', apiRoutes);
app.get('/healthcheck', apiRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[server error]', err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

// Start Server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 CNC Web App Server listening on http://0.0.0.0:${PORT}`);
  console.log(`   RHINO_COMPUTE_URL: ${process.env.RHINO_COMPUTE_URL || 'http://localhost:6500/'}`);
  console.log(`====================================================`);
});

// Graceful Shutdown for Cloud Run / Kubernetes
function gracefulShutdown(signal) {
  console.log(`[server] Received ${signal}. Closing HTTP server...`);
  server.close(() => {
    console.log('[server] HTTP server closed. Exiting process.');
    process.exit(0);
  });
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;
