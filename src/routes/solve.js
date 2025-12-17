const express = require('express')
const router = express.Router()
const fs = require('fs')
const path = require('path')
const md5File = require('md5-file')
const fetch = require('node-fetch')

// Helper: Format JS inputs into Rhino Compute DataTrees
function formatInputs(inputs) {
  const values = []
  
  for (const [key, value] of Object.entries(inputs)) {
    let type = 'System.String'
    let data = value

    if (typeof value === 'boolean') {
      type = 'System.Boolean'
    } else if (typeof value === 'number') {
      type = 'System.Double' // Default to double for all numbers
      // If you strictly need integers, you could check Number.isInteger(value) -> System.Int32
    }

    // Construct the DataTree object
    const param = {
      ParamName: key,
      InnerTree: {
        "{ 0; }": [ 
          { 
            type: type, 
            data: data 
          } 
        ]
      }
    }
    values.push(param)
  }
  return values
}

router.post('/', async (req, res, next) => {
  try {
    const data = req.body
    const definitionPath = path.join(__dirname, '../files/', data.definition)
    
    if (!fs.existsSync(definitionPath)) {
      throw new Error(`Definition not found: ${data.definition}`)
    }

    // 1. Prepare File & Hash
    const buffer = fs.readFileSync(definitionPath)
    const algo = buffer.toString('base64')
    const pointer = "md5_" + md5File.sync(definitionPath)

    // 2. Format Inputs
    const rhInputs = formatInputs(data.inputs)

    // 3. Construct the Hops-style JSON Body
    const requestBody = {
      "absolutetolerance": 0.01,
      "angletolerance": 1.0,
      "modelunits": "Inches", 
      "algo": algo,         // Send file content ensures it works even if cache is cleared
      "pointer": pointer,   // Send pointer for speed if server cached it
      "cachesolve": false,
      "values": rhInputs
    }

    // 4. Send to /grasshopper endpoint
    let url = process.env.RHINO_COMPUTE_URL
    if (!url.endsWith('/')) url += '/'
    url += 'grasshopper'

    const apiKey = process.env.RHINO_COMPUTE_KEY

    console.log(`Solving ${data.definition} on ${url}...`)

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
      console.error(`Compute Error ${response.status}: ${errorText}`)
      throw new Error(`Compute Server Error ${response.status}: ${errorText}`)
    }

    const result = await response.json()
    res.json(result)

  } catch (error) {
    next(error) // Pass to Express error handler
  }
})

module.exports = router