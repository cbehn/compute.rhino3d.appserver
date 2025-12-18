const express = require('express')
const router = express.Router()
const compute = require('compute-rhino3d')
const md5File = require('md5-file')

// FIX 1: Import the entire definitions module so we can access .registerDefinitions() AND .getParams()
const definitionsModule = require('../definitions.js') 

/**
 * Set url and apikey used to communicate with a compute server
 */
function setComputeParams (){
  compute.url = process.env.RHINO_COMPUTE_URL
  compute.apiKey = process.env.RHINO_COMPUTE_KEY
}

/**
 * Return list of definitions available on this server. The definitions
 * are located in the 'files' directory. These are the names that can be
 * used to call '/:definition_name` for details about a specific definition
 */
router.get('/',  function(req, res, next) {
  let definitions = req.app.get('definitions');

  // FIX 2: Auto-Rescan if empty using the module we just imported
  if (!definitions || definitions.length === 0) {
    console.log('Definitions list empty. Re-scanning files directory...');
    definitions = definitionsModule.registerDefinitions(); 
    req.app.set('definitions', definitions); 
  }

  let responseList = []
  definitions.forEach( def => {
    responseList.push({name: def.name})
  })

  res.setHeader('Content-Type', 'application/json')
  res.send(JSON.stringify(responseList))
})

function describeDefinition(definition, req, res, next){
  if(definition === undefined)
    throw new Error('Definition not found on server.') 

  let data = {name: definition.name}

  if(!Object.prototype.hasOwnProperty.call(definition, 'inputs')
     && !Object.prototype.hasOwnProperty.call(definition, 'outputs')) {

    let fullUrl = req.protocol + '://' + req.get('host')
    let definitionPath = `${fullUrl}/definition/${definition.id}`

    // FIX 3: Update this call to use the module variable
    definitionsModule.getParams(definitionPath).then(data => {
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

router.get('/definition_description', function(req, res, next){
  let fullPath = req.query['path']
  let definition = req.app.get('definitions').find(o => o.name === fullPath)
  if(definition === undefined){
    const hash = md5File.sync(fullPath)
    let definitions = req.app.get('definitions')
    definition = {
      name: fullPath,
      id:hash,
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
router.get('/:name', function(req, res, next){
  let definition = req.app.get('definitions').find(o => o.name === req.params.name)
  describeDefinition(definition, req, res, next)
})

module.exports = router