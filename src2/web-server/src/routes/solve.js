/**
 * routes/solve.js — POST /solve endpoint.
 *
 * Receives definition name and inputs from the CNC frontend, formats them into
 * Rhino DataTree structure, and forwards the solve request to Rhino Compute
 * at /grasshopper.
 */
const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const md5File = require('md5-file');
const fetch = require('node-fetch');
const computeStatus = require('../services/compute-status');
const { getComputeHeaders } = require('../utils/gcp-auth');

// Helper: Format JavaScript inputs into Rhino DataTree structure
function formatInputs(inputs = {}) {
  const values = [];

  for (const [key, value] of Object.entries(inputs)) {
    let type = 'System.String';

    if (typeof value === 'boolean') {
      type = 'System.Boolean';
    } else if (Number.isInteger(value)) {
      type = 'System.Int32';
    } else if (typeof value === 'number') {
      type = 'System.Double';
    }

    const param = {
      ParamName: key,
      InnerTree: {
        '{0}': [
          {
            type: type,
            data: value
          }
        ]
      }
    };
    values.push(param);
  }
  return values;
}

const COMPUTE_TIMEOUT_MS = 120000; // 120 seconds

router.post('/', async (req, res, next) => {
  if (res.socket) {
    res.socket.setTimeout(COMPUTE_TIMEOUT_MS + 10000);
  }

  computeStatus.touchActivity();

  const data = req.body || {};
  const definitionName = data.definition;

  if (!definitionName) {
    return res.status(400).json({ error: 'Missing definition name in request body.' });
  }

  try {
    const definitions = req.app.get('definitions') || [];
    const defEntry = definitions.find(d => d.name === definitionName);

    if (!defEntry) {
      throw new Error(`Definition not found on server: ${definitionName}`);
    }

    const buffer = await fs.readFile(defEntry.path);
    const algo = buffer.toString('base64');
    const pointer = 'md5_' + md5File.sync(defEntry.path);

    const rhInputs = formatInputs(data.inputs);

    const requestBody = {
      absolutetolerance: 0.01,
      angletolerance: 1.0,
      modelunits: 'Inches',
      algo: algo,
      pointer: pointer,
      cachesolve: false,
      values: rhInputs
    };

    let computeUrl = process.env.RHINO_COMPUTE_URL || 'http://localhost:6500/';
    if (!computeUrl.endsWith('/')) computeUrl += '/';
    const url = computeUrl + 'grasshopper';
    const apiKey = process.env.RHINO_COMPUTE_KEY || '';

    console.log(`[solve] Solving ${definitionName} against ${url}...`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), COMPUTE_TIMEOUT_MS);

    const headers = await getComputeHeaders(url, apiKey);

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errorText = await response.text();
      try {
        const parsed = JSON.parse(errorText);
        if (parsed && Array.isArray(parsed.values)) {
          console.warn(`[solve] Compute returned ${response.status} with usable values. Passing through.`);
          return res.status(200).json(parsed);
        }
      } catch {
        // Ignore parse error
      }
      throw new Error(`Rhino Compute returned HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    return res.json(result);

  } catch (error) {
    if (error.name === 'AbortError') {
      return res.status(504).json({
        error: 'Gateway Timeout',
        message: `Rhino Compute did not respond within ${COMPUTE_TIMEOUT_MS / 1000}s. The solve may still be running.`
      });
    }
    next(error);
  }
});

module.exports = router;
