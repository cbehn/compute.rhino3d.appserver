/**
 * routes/definition.js — Grasshopper definition metadata and download routes.
 */
const express = require('express');
const router = express.Router();
const definitions = require('../definitions');

router.get('/:name/info', async (req, res, next) => {
  try {
    const list = req.app.get('definitions') || [];
    const definition = list.find(o => o.name === req.params.name);
    if (!definition) {
      return res.status(404).json({ error: `Definition not found: ${req.params.name}` });
    }

    let params;
    try {
      params = await definitions.getParams(definition.path);
    } catch (err) {
      console.warn(`[definition/info] Compute inspection failed, using sidecar defaults: ${err.message}`);
      params = { inputs: [], outputs: [], description: definition.description || '', view: true };
    }

    const responsePayload = {
      inputs: params.inputs,
      outputs: params.outputs,
      description: params.description || definition.description || '',
      view: params.view,
      camera: definition.camera,
      defaultTheme: definition.defaultTheme,
      grid: definition.grid,
      defaultModels: definition.defaultModels,
      dropdowns: definition.dropdowns
    };

    res.json(responsePayload);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', (req, res, next) => {
  const list = req.app.get('definitions') || [];
  const definition = list.find(o => o.id === req.params.id);

  if (!definition) {
    return res.status(404).send('Definition file not found.');
  }

  const options = {
    headers: {
      'x-timestamp': Date.now(),
      'x-sent': true
    }
  };

  res.sendFile(definition.path, options, (error) => {
    if (error) console.error('[definition/file] Error sending file:', error);
  });
});

module.exports = router;
