const fs = require('fs')
const path = require('path')
const md5File = require('md5-file')
const fetch = require('node-fetch')

// Helper: Extract the raw data string from the Rhino DataTree JSON structure
function extractDefaultValue(rawDefault) {
  // 1. If undefined or null, return undefined
  if (rawDefault === undefined || rawDefault === null) return undefined;

  // 2. Handle standard Rhino DataTree structure
  // Expected: { InnerTree: { "{0}": [ { type: "...", data: "..." } ] } }
  if (rawDefault.InnerTree) {
    const branches = Object.values(rawDefault.InnerTree);
    
    // Check if we have at least one branch with data
    if (branches.length > 0 && branches[0].length > 0) {
      const item = branches[0][0];
      // Return the raw data string (e.g., "0.15", "5", "True")
      return item.data; 
    }
  }

  // 3. Fallback: If it's already a simple value (unlikely with standardized Hops, but possible)
  return rawDefault;
}

// Helper: Cast string values to their correct JS type based on Hops ParamType
function castValue(value, paramType) {
  if (value === undefined || value === null) return undefined;

  // Normalize type to lowercase for easier comparison
  const type = (paramType || '').toLowerCase();

  // 1. Integers
  if (type === 'integer' || type === 'int' || type === 'system.int32') {
    return parseInt(value, 10);
  }

  // 2. Floats / Numbers
  if (type === 'number' || type === 'double' || type === 'system.double') {
    return parseFloat(value);
  }

  // 3. Booleans
  if (type === 'boolean' || type === 'bool' || type === 'system.boolean') {
    const s = String(value).toLowerCase();
    return s === 'true';
  }

  // 4. Default: Return as string
  return value;
}

function getFilesSync(dir) {
  return fs.readdirSync(dir)
}

function registerDefinitions() {
  const filesDir = path.join(__dirname, 'files/')
  
  if (!fs.existsSync(filesDir)) {
    return [];
  }

  let files = getFilesSync(filesDir)
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

  return definitions
}

async function getParams(definitionPath) {
  // 1. Read the file fresh (No Caching as requested)
  const buffer = fs.readFileSync(definitionPath)
  const algo = buffer.toString('base64')
  
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

    const result = await response.json()
    
    // 2. Parse Inputs with Robust Handling
    // Handle casing variations (Inputs vs inputs vs inputNames)
    let rawInputs = result.inputs || result.Inputs || result.inputNames || [];
    
    let inputs = rawInputs.map(input => {
        // Normalize Fields
        const name = input.Name || input.name;
        const description = input.Description || input.description || "";
        const paramType = input.ParamType || input.paramType || "String"; // Default to string if missing

        // Robust Default Extraction
        const rawDefault = (input.Default !== undefined) ? input.Default : input.default;
        const rawDefaultValue = extractDefaultValue(rawDefault);
        const defaultValue = castValue(rawDefaultValue, paramType);

        // Normalize Ranges
        // We prioritize explicit Minimum/Maximum fields for values
        const minRaw = (input.Minimum !== undefined) ? input.Minimum : input.minimum;
        const maxRaw = (input.Maximum !== undefined) ? input.Maximum : input.maximum;
        
        return {
            name: name,
            description: description,
            paramType: paramType, // "Number", "Integer", "Boolean"
            default: defaultValue,
            minimum: castValue(minRaw, paramType),
            maximum: castValue(maxRaw, paramType),
            // We do NOT map AtLeast/AtMost to min/max anymore, as they usually refer to item counts, not value constraints.
        };
    });

    let outputs = result.outputs || result.Outputs || result.outputNames
    const description = result.description || result.Description || ''

    // Determine view visibility (legacy logic)
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