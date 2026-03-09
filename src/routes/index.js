/**
 * routes/index.js — Landing page and definitions API.
 *
 * Serves the portfolio landing page, provides a JSON API to list available
 * Grasshopper definitions, and offers routes to describe individual
 * definitions (inputs, outputs, metadata). Also handles auto-rescanning
 * the files directory if the definitions list is empty.
 *
 * Routes:
 *  GET /                          — Landing page (landing.hbs)
 *  GET /api/definitions           — JSON list of all registered definitions
 *  GET /definition_description    — Describe a definition by file path
 *  GET /:name                     — Describe a definition by filename
 */
const express = require('express')
const router = express.Router()
const compute = require('compute-rhino3d')
const md5File = require('md5-file')

// FIX: Import registerDefinitions so we can use it below
const { getParams, registerDefinitions } = require('../definitions.js')

/**
 * Set url and apikey used to communicate with a compute server
 */
function setComputeParams() {
  compute.url = process.env.RHINO_COMPUTE_URL
  compute.apiKey = process.env.RHINO_COMPUTE_KEY
}

/**
 * NEW: Landing Page
 */
router.get('/', function (req, res, next) {
  res.render('landing');
});

/**
 * Return list of definitions available on this server (JSON API). 
 */
router.get('/api/definitions', function (req, res, next) {
  let definitions = req.app.get('definitions');

  // --- FIX: Auto-Rescan if empty ---
  if (!definitions || definitions.length === 0) {
    console.log('Definitions list empty. Re-scanning files directory...');
    // FIX: Call the function directly (it was previously undefined as definitionsModule)
    definitions = registerDefinitions();
    req.app.set('definitions', definitions); // Update the app memory
  }
  // --------------------------------

  let responseList = []
  if (definitions) {
    definitions.forEach(def => {
      responseList.push({
        name: def.name,
        category: def.category,
        description: def.description,
        date: def.date,
        version: def.version
      })
    })
  }

  res.setHeader('Content-Type', 'application/json')
  res.send(JSON.stringify(responseList))
})

function describeDefinition(definition, req, res, next) {
  if (definition === undefined)
    throw new Error('Definition not found on server.')

  let data = { name: definition.name }

  if (!Object.prototype.hasOwnProperty.call(definition, 'inputs')
    && !Object.prototype.hasOwnProperty.call(definition, 'outputs')) {

    let fullUrl = req.protocol + '://' + req.get('host')
    let definitionPath = `${fullUrl}/definition/${definition.id}`

    getParams(definitionPath).then(data => {
      // cache
      definition.description = data.description
      definition.inputs = data.inputs
      definition.outputs = data.outputs

      // pretty print json
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify(data, null, 4))
    }).catch(next)
  } else {
    data.description = definition.description
    data.inputs = definition.inputs
    data.outputs = definition.outputs

    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify(data, null, 4))
  }
}

router.get('/definition_description', function (req, res, next) {
  let fullPath = req.query['path']
  let definition = req.app.get('definitions').find(o => o.name === fullPath)
  if (definition === undefined) {
    const hash = md5File.sync(fullPath)
    let definitions = req.app.get('definitions')
    definition = {
      name: fullPath,
      id: hash,
      path: fullPath
    }
    definitions.push(definition)
  }
  describeDefinition(definition, req, res, next)
})

/**
 * This route needs to be declared after /definition_description so it won't be
 * called when '/definition_description' is requested
 */
router.get('/:name', function (req, res, next) {
  let definition = req.app.get('definitions').find(o => o.name === req.params.name)
  describeDefinition(definition, req, res, next)
})

module.exports = router