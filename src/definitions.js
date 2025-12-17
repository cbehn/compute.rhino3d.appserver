const fs = require('fs')
const path = require('path')
const md5File = require('md5-file')
const compute = require('compute-rhino3d')
const camelcaseKeys = require('camelcase-keys')
const fetch = require('node-fetch')

/*
function getFiles(dir) {
  return new Promise ( (resolve, reject) => {
    fs.readdir(dir, (err, files) => {
      if(err) reject(err)
      else resolve(files)
    })
  } )
}
*/
function getFilesSync(dir) {
  return fs.readdirSync(dir)
}

function registerDefinitions() {
  let files = getFilesSync(path.join(__dirname, 'files/'))
  let definitions = []
  files.forEach( file => {
    if(file.includes('.gh') || file.includes('.ghx')) {
      const fullPath = path.join(__dirname, 'files/' + file)
      const hash = md5File.sync(fullPath)
      
      definitions.push({
        name: file,
        id:hash,
        path: fullPath
      })
    }
  })
  return definitions
}

async function getParams(definitionPath) { // <--- Changed arg from 'definitionUrl' to 'definitionPath'
    
    const buffer = fs.readFileSync(definitionPath);
    
    // 1. Log the URL to make sure it looks right
    const url = process.env.RHINO_COMPUTE_URL + 'io';
    console.log("🚀 Sending to Azure URL:", url);
  
    const apiKey = process.env.RHINO_COMPUTE_KEY;
  
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'RhinoComputeKey': apiKey
      },
      body: buffer
    });
  
    // 2. If it fails, let's read the text body to see the REAL error message
    if(!response.ok) {
      const errorText = await response.text();
      console.error("❌ Azure Error Body:", errorText);
      throw new Error(`Azure Failed: ${response.status} - ${errorText}`);
    }
  

  let result = await response.json()
  
  // ... (Keep the rest of your logic for camelcaseKeys, input processing, etc.)
  result = camelcaseKeys(result, {deep: true})
  let inputs = result.inputs === undefined ? result.inputNames : result.inputs
  let outputs = result.outputs === undefined ? result.outputNames: result.outputs
  const description = result.description === undefined ? '' : result.description

  let view = true
  inputs.forEach( i => {
    if (i.paramType === 'Geometry' || i.paramType === 'Point' || i.paramType === 'Curve') {
        view = false
    }
  })

  return { description, inputs, outputs, view }
}

module.exports = { registerDefinitions, getParams }
