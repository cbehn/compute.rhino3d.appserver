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

  const baseNames = new Set()
  files.forEach(file => {
    if (file.endsWith('.gh') || file.endsWith('.ghx')) {
      baseNames.add(path.parse(file).name)
    }
  })

  baseNames.forEach(base => {
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
  
  // Standard Hops/Compute Request Body
  const requestBody = {
    "absolutetolerance": 0.01,
    "angletolerance": 1.0,
    "modelunits": "Inches",
    "algo": algo,
    "pointer": "md5_" + md5File.sync(definitionPath),
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
    
    // Convert keys to camelCase (e.g. "Default" -> "default")
    // Note: This relies on camelcase-keys working correctly. 
    result = camelcaseKeys(result, { deep: true })
    
    // Safely grab inputs array (handle casing variations)
    let rawInputs = result.inputs || result.Inputs || result.inputNames || [];
    
    // Explicitly map inputs to ensure Client expects properties exist
    // This fixes issues where 'AtLeast' becomes 'atLeast' but client wants 'minimum'
    // And ensures 'default' is definitely set.
    let inputs = rawInputs.map(input => {
        return {
            name: input.name || input.Name,
            description: input.description || input.Description,
            paramType: input.paramType || input.ParamType,
            
            // Map Defaults
            default: (input.default !== undefined) ? input.default : input.Default,
            
            // Map Ranges (Client expects 'minimum'/'maximum')
            minimum: (input.minimum !== undefined) ? input.minimum : (input.atLeast !== undefined ? input.atLeast : input.AtLeast),
            maximum: (input.maximum !== undefined) ? input.maximum : (input.atMost !== undefined ? input.atMost : input.AtMost),
        };
    });

    let outputs = result.outputs || result.Outputs || result.outputNames
    const description = result.description || result.Description || ''

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