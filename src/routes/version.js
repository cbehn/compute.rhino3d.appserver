/**
 * routes/version.js — GET /version endpoint.
 *
 * Returns combined version information from both the AppServer (package.json)
 * and the upstream Rhino Compute server as a single JSON response.
 */
const express = require('express')
const router = express.Router()
const compute = require('compute-rhino3d')
const getVersion = require('../version.js').getVersion

router.get('/', async function(req, res, next){

  const result = await getVersion()
  
  res.setHeader('Content-Type', 'application/json')
  res.send(JSON.stringify(result))
})

module.exports = router

