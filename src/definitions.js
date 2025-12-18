const fs = require('fs')
const path = require('path')
const md5File = require('md5-file')
const camelcaseKeys = require('camelcase-keys')
const fetch = require('node-fetch')

function getFilesSync(dir) {
  return fs.readdirSync(dir)
}


function registerDefinitions() {
  const filesDir = path.join(__dirname, 'files/')
  console.log('--- DEBUG: Definition Scanner ---');
  console.log('Looking for files in:', filesDir);

  if (!fs.existsSync(filesDir)) {
    console.error('ERROR: Files directory not found at:', filesDir);
    return [];
  }

  let files = getFilesSync(filesDir)
  console.log('Raw files found:', files);

  let definitions = []
  // ... existing logic to populate definitions ...

  const baseNames = new Set()
  files.forEach(file => {
    if (file.endsWith('.gh') || file.endsWith('.ghx')) {
      baseNames.add(path.parse(file).name)
    }
  })

  baseNames.forEach(base => {
    // ... existing loop logic ...
    let fileName = null
    if (fs.existsSync(path.join(filesDir, base + '.gh'))) {
      fileName = base + '.gh'
    } else if (fs.existsSync(path.join(filesDir, base + '.ghx'))) {
      fileName = base + '.ghx'
    }

    if (fileName) {
      const fullPath = path.join(filesDir, fileName)
      const hash = md5File.sync(fullPath)
      
      definitions.push({
        name: fileName,
        id: hash,
        path: fullPath
      })
    }
  })

  console.log('Registered definitions:', definitions);
  console.log('---------------------------------');

  return definitions
}

async function getParams(definitionPath) {
  const buffer = fs.readFileSync(definitionPath)
  const algo = buffer.toString('base64')
  
  // FIX: Match Hops Protocol exactly
  const requestBody = {
    "absolutetolerance": 0.01, // Standard Rhino tolerance
    "angletolerance": 1.0,
    "modelunits": "Inches",    // or "Millimeters", usually doesn't break IO but good to have
    "algo": algo,
    "pointer": "md5_" + md5File.sync(definitionPath), // FIX: Add 'md5_' prefix
    "cachesolve": false,
    "values": []
  }

  let url = process.env.RHINO_COMPUTE_URL
  if (!url.endsWith('/')) url += '/' 
  url += 'io'

  const apiKey = process.env.RHINO_COMPUTE_KEY

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'RhinoComputeKey': apiKey
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Compute Server returned ${response.status}: ${errorText}`)
    }

    let result = await response.json()
    result = camelcaseKeys(result, { deep: true })
    
    let inputs = result.inputs === undefined ? result.inputNames : result.inputs
    let outputs = result.outputs === undefined ? result.outputNames : result.outputs
    const description = result.description === undefined ? '' : result.description

    let view = true
    if (inputs) {
      inputs.forEach(i => {
        if (i.paramType === 'Geometry' || i.paramType === 'Point' || i.paramType === 'Curve') {
          view = false
        }
      })
    }

    return { description, inputs, outputs, view }

  } catch (error) {
    console.error(`Error getting params for ${definitionPath}:`)
    console.error(error)
    throw error
  }
}

module.exports = { registerDefinitions, getParams }