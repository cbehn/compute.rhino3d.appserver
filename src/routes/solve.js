const express = require('express')
const router = express.Router()
const fs = require('fs').promises // Use the Promise API for non-blocking file reads
const path = require('path')
const md5File = require('md5-file')
const fetch = require('node-fetch')
const azureService = require('../services/azure-service')

// Helper: Format JavaScript inputs into the complex "DataTree" structure Rhino Compute expects.
function formatInputs(inputs) {
  const values = []
  
  for (const [key, value] of Object.entries(inputs)) {
    // Determine the type so Rhino knows how to handle the data
    let type = 'System.String' // Default fallback
    
    if (typeof value === 'boolean') {
      type = 'System.Boolean'
    } else if (Number.isInteger(value)) {
      type = 'System.Int32'
    } else if (typeof value === 'number') {
      type = 'System.Double'
    }

    // Wrap the value in the standard Hops/Compute structure
    const param = {
      ParamName: key,
      InnerTree: {
        "{0}": [ 
          { 
            type: type, 
            data: value 
          } 
        ]
      }
    }
    values.push(param)
  }
  return values
}

router.post('/', async (req, res, next) => {
  const data = req.body
  const definitionName = data.definition

  try {
    // 1. Find the requested definition in our list
    const definitions = req.app.get('definitions')
    const defEntry = definitions.find(d => d.name === definitionName)
    
    if (!defEntry) {
      throw new Error(`Definition not found: ${definitionName}`)
    }

    // 2. Read the file from disk asynchronously
    // We read it fresh every time so you can update files without restarting the server.
    const buffer = await fs.readFile(defEntry.path)
    const algo = buffer.toString('base64')
    
    // Calculate a hash to help Compute cache the definition
    const pointer = "md5_" + md5File.sync(defEntry.path)

    // 3. Prepare the request payload
    const rhInputs = formatInputs(data.inputs)
    
    const requestBody = {
      "absolutetolerance": 0.01,
      "angletolerance": 1.0,
      "modelunits": "Inches", 
      "algo": algo,         // sending the full file content ensures it works even if the server cache is empty
      "pointer": pointer,   
      "cachesolve": false,
      "values": rhInputs
    }

    // Construct the URL
    let computeUrl = process.env.RHINO_COMPUTE_URL
    if (!computeUrl.endsWith('/')) computeUrl += '/'
    const url = computeUrl + 'grasshopper'
    const apiKey = process.env.RHINO_COMPUTE_KEY

    // 4. Send the request with "Retry Logic"
    // Since we use Spot Instances, the server might be gone. 
    // If the request fails, we try to wake it up and send it again.
    
    let attempts = 0;
    const maxAttempts = 2; // Try once, retry once

    while (attempts < maxAttempts) {
      try {
        console.log(`Solving ${definitionName} (Attempt ${attempts + 1})...`)

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'RhinoComputeKey': apiKey
          },
          body: JSON.stringify(requestBody)
        })

        // If the Compute Server returns a logic error (like 500), we throw it here
        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`Compute Server returned ${response.status}: ${errorText}`)
        }

        // Success! Return the answer to the user.
        const result = await response.json()
        return res.json(result)

      } catch (err) {
        // Check if this is a network error (meaning the server is down/unreachable)
        const isNetworkError = err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.type === 'system';
        
        // If it's a network error and we haven't retried yet...
        if (isNetworkError && attempts === 0) {
           console.warn("Compute Server unreachable. Attempting to wake up VM...");
           
           // Call compute service to wake up the machine. 
           // This waits until the VM is effectively "Running".
           await azureService.ensureRunning();
           
           attempts++;
           // The loop will now run again (Attempt 2)
        } else {
           // If it's not a network error (e.g. invalid inputs), or we already failed twice, give up.
           throw err;
        }
      }
    }

  } catch (error) {
    // Pass any final errors to the global error handler
    next(error) 
  }
})

module.exports = router