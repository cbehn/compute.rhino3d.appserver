const express = require('express')
const router = express.Router()
const compute = require('compute-rhino3d')
const {performance} = require('perf_hooks')
const fs = require('fs')         // <--- ADDED
const fetch = require('node-fetch') // <--- ADDED

const multer = require('multer')
const storage = multer.memoryStorage()
const upload = multer({ storage: storage })

const NodeCache = require('node-cache')
const cache = new NodeCache()

const memjs = require('memjs')
let mc = null

let definition = null

if(process.env.MEMCACHIER_SERVERS !== undefined) {
  mc = memjs.Client.create(process.env.MEMCACHIER_SERVERS, {
    failover: true,
    timeout: 1,
    keepAlive: true
  })
}

function computeParams (req, res, next){
  compute.url = process.env.RHINO_COMPUTE_URL
  compute.apiKey = process.env.RHINO_COMPUTE_KEY
  next()
}

function collectParams (req, res, next){
  res.locals.params = {}
  switch (req.method){
  case 'HEAD':
  case 'GET':
    res.locals.params.definition = req.params.definition
    res.locals.params.inputs = req.query
    break
  case 'POST':
    res.locals.params = req.body
    if (req.file) {
      if (res.locals.params.inputs === undefined) {
        res.locals.params.inputs = {}
      }
      const fileAsBase64 = req.file.buffer.toString('base64')
      res.locals.params.inputs['importFile'] = fileAsBase64
    }
    break
  default:
    next()
    break
  }

  let definitionName = res.locals.params.definition
  if (definitionName===undefined)
    definitionName = res.locals.params.pointer
  
  // Find the definition object which contains the local path
  definition = req.app.get('definitions').find(o => o.name === definitionName)
  if(!definition)
    throw new Error('Definition not found on server.')

  res.locals.params.definition = definition
  next()
}

function checkCache (req, res, next){
  const key = {}
  key.definition = { 'name': res.locals.params.definition.name, 'id': res.locals.params.definition.id }
  key.inputs = res.locals.params.inputs
  if (res.locals.params.values!==undefined)
    key.inputs = res.locals.params.values
  res.locals.cacheKey = JSON.stringify(key)
  res.locals.cacheResult = null

  if(mc === null){
    const result = cache.get(res.locals.cacheKey)
    res.locals.cacheResult = result !== undefined ? result : null
    next()
  } else {
    if(mc !== null) {
      mc.get(res.locals.cacheKey, function(err, val) {
        if(err == null) {
          res.locals.cacheResult = val
        }
        next()
      })
    }
  }
}

function commonSolve (req, res, next){
  const timePostStart = performance.now()

  res.setHeader('Cache-Control', 'public, max-age=31536000')
  res.setHeader('Content-Type', 'application/json')

  if(res.locals.cacheResult !== null) {
    const timespanPost = Math.round(performance.now() - timePostStart)
    res.setHeader('Server-Timing', `cacheHit;dur=${timespanPost}`)
    res.send(res.locals.cacheResult)
    return
  } else {
    // 1. Prepare DataTrees from inputs
    let trees = []
    if(res.locals.params.inputs !== undefined) {
      for (let [key, value] of Object.entries(res.locals.params.inputs)) {
        let param = new compute.Grasshopper.DataTree(key)
        param.append([0], Array.isArray(value) ? value : [value])
        trees.push(param)
      }
    }
    if(res.locals.params.values !== undefined) {
      for (let index=0; index<res.locals.params.values.length; index++) {
        let param = new compute.Grasshopper.DataTree('')
        param.data = res.locals.params.values[index]
        trees.push(param)
      }
    }

    // --- FIX: READ FILE & DIRECT UPLOAD (No Callback URLs) ---
    
    // Read the file from disk (definition.path comes from the app startup)
    const buffer = fs.readFileSync(definition.path);
    const algo = buffer.toString('base64');
    
    // Construct the request body manually
    const requestBody = {
        algo: algo,       // The full file content
        pointer: null,    // No URL pointer
        values: trees     // The inputs
    };

    const timePreComputeServerCall = performance.now()
    let computeServerTiming = null

    // Manual Fetch to /grasshopper endpoint
    fetch(compute.url + 'grasshopper', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'RhinoComputeKey': compute.apiKey
        },
        body: JSON.stringify(requestBody)
    })
    .then( (response) => {
      if(!response.ok) {
        // If error, try to get the text body for debugging
        return response.text().then(text => {
            throw new Error(`Compute Server Error ${response.status}: ${text}`);
        });
      }
      computeServerTiming = response.headers
      return response.text()
    })
    .then( (result) => {
      // --- END FIX ---

      const r = JSON.parse(result)
      // Clean up response
      if(r.pointer) delete r.pointer
      
      const finalJson = JSON.stringify(r);

      // Cache the result
      if(mc !== null) {
        mc.set(res.locals.cacheKey, finalJson, {expires:0}, function(err, val){})
      } else {
        cache.set(res.locals.cacheKey, finalJson)
      }

      res.send(finalJson)
    })
    .catch( (error) => { 
      console.error("Solve Error:", error); // Log it clearly
      next(error)
    })
  }
}

const pipeline = [upload.single('file'), computeParams, collectParams, checkCache, commonSolve]

router.head('/:definition',pipeline)
router.get('/:definition', pipeline)
router.post('/', pipeline)

module.exports = router