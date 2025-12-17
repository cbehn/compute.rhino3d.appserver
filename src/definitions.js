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
  let files = getFilesSync(filesDir)
  let definitions = []

  // 1. Identify all unique definition names (ignoring extension)
  const baseNames = new Set()
  files.forEach(file => {
    if (file.endsWith('.gh') || file.endsWith('.ghx')) {
      baseNames.add(path.parse(file).name)
    }
  })

  // 2. Register the best version for each definition
  baseNames.forEach(base => {
    let fileName = null
    
    // Prefer .gh (Binary) -> Smaller, faster upload
    if (fs.existsSync(path.join(filesDir, base + '.gh'))) {
      fileName = base + '.gh'
    } 
    // Fallback to .ghx (XML) -> Larger, slower
    else if (fs.existsSync(path.join(filesDir, base + '.ghx'))) {
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

  return definitions
}

async function getParams(definitionPath) {
  
  // Read the file from disk (fixes the URL/Path confusion)
  const buffer = fs.readFileSync(definitionPath)
  
  // Construct the IO URL
  let url = process.env.RHINO_COMPUTE_URL
  if (!url.endsWith('/')) url += '/' // Ensure trailing slash
  url += 'io'

  const apiKey = process.env.RHINO_COMPUTE_KEY

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'RhinoComputeKey': apiKey,
        'Content-Length': buffer.length.toString() // Help server allocate memory
      },
      body: buffer
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Compute Server returned ${response.status}: ${errorText}`)
    }

    let result = await response.json()
    
    // Format inputs/outputs to camelCase for JS consumption
    result = camelcaseKeys(result, { deep: true })
    
    let inputs = result.inputs === undefined ? result.inputNames : result.inputs
    let outputs = result.outputs === undefined ? result.outputNames : result.outputs
    const description = result.description === undefined ? '' : result.description

    // Determine if we should show a 3D view based on output types
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