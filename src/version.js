/**
 * version.js — Version information aggregator.
 *
 * Fetches the Rhino Compute server's /version endpoint and combines it with
 * the AppServer's own version (from package.json). The merged result is
 * returned to the /version route so clients can see both versions at once.
 */
const appserverVersion = require('../package.json').version

async function getVersion() {

  let request = {
    'method':'GET',
    'headers': {'RhinoComputeKey': process.env.RHINO_COMPUTE_KEY }
  }

  const response = await fetch( process.env.RHINO_COMPUTE_URL + 'version', request )
  console.log(response)
  const result = await response.json()

  result.appserver = appserverVersion

  console.log(result)

  return result

}

module.exports = { getVersion }
