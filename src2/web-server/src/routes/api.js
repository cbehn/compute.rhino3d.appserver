/**
 * routes/api.js — General API routes for definitions, healthchecks, and wake status.
 */
const express = require('express');
const router = express.Router();
const computeStatus = require('../services/compute-status');
const { registerDefinitions } = require('../definitions');

// Return list of definitions available on this server
router.get('/definitions', (req, res) => {
  let definitions = req.app.get('definitions');

  if (!definitions || definitions.length === 0) {
    definitions = registerDefinitions();
    req.app.set('definitions', definitions);
  }

  const responseList = (definitions || []).map(def => ({
    name: def.name,
    category: def.category || 'cnc',
    description: def.description || '',
    date: def.date || '',
    version: def.version || ''
  }));

  res.json(responseList);
});

// Wakeup trigger endpoint (called by frontend startup overlay)
router.post('/wakeup', (req, res) => {
  computeStatus.touchActivity();
  res.json({ message: 'Rhino Compute status pinged.' });
});

// Status check endpoint (polled by frontend startup overlay until live)
router.get('/wakeStatus', async (req, res) => {
  const status = await computeStatus.getWakeStatus();
  res.json(status);
});

// Proxy healthcheck to Rhino Compute
router.get('/healthcheck', async (req, res) => {
  const result = await computeStatus.checkHealth();
  if (result.ok) {
    res.status(200).send(result.body || 'healthy');
  } else {
    res.status(502).json({ error: 'Rhino Compute unreachable', details: result.error });
  }
});

module.exports = router;
