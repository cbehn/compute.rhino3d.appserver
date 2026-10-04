/**
 * definitions.js — Grasshopper definition registry and parameter extractor.
 *
 * Scans the cnc/scripts/ directory for .gh/.ghx Grasshopper definitions,
 * reads companion sidecar JSON files, and interfaces with Rhino Compute's /io
 * endpoint to inspect definition inputs, outputs, and metadata.
 */
const fs = require('fs');
const path = require('path');
const md5File = require('md5-file');
const fetch = require('node-fetch');

// Helper: Extract raw data string from Rhino DataTree JSON structure
function extractDefaultValue(rawDefault) {
  if (rawDefault === undefined || rawDefault === null) return undefined;

  if (rawDefault && typeof rawDefault === 'object' && rawDefault.InnerTree) {
    const branches = Object.values(rawDefault.InnerTree);
    for (const branch of branches) {
      if (Array.isArray(branch) && branch.length > 0 && branch[0].data !== undefined) {
        return branch[0].data;
      }
    }
    return undefined;
  }

  return rawDefault;
}

// Helper: Cast string values to correct JS types based on Hops ParamType
function castValue(value, paramType) {
  if (value === undefined || value === null) return undefined;

  const type = (paramType || '').toLowerCase();

  if (type === 'integer' || type === 'int' || type === 'system.int32') {
    return parseInt(value, 10);
  }
  if (type === 'number' || type === 'double' || type === 'system.double') {
    return parseFloat(value);
  }
  if (type === 'boolean' || type === 'bool' || type === 'system.boolean') {
    return String(value).toLowerCase() === 'true';
  }
  if (type === 'string' || type === 'text' || type === 'system.string') {
    let str = String(value);
    if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
      str = str.slice(1, -1);
    }
    return str;
  }

  return value;
}

function scanDirectory(dir, category = 'cnc') {
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir);
  const results = [];
  const baseNames = new Set();

  files.forEach(file => {
    if (file.endsWith('.gh') || file.endsWith('.ghx')) {
      baseNames.add(path.parse(file).name);
    }
  });

  baseNames.forEach(base => {
    let fileName = null;
    if (fs.existsSync(path.join(dir, base + '.gh'))) {
      fileName = base + '.gh';
    } else if (fs.existsSync(path.join(dir, base + '.ghx'))) {
      fileName = base + '.ghx';
    }

    if (fileName) {
      const fullPath = path.join(dir, fileName);
      const hash = md5File.sync(fullPath);

      const def = {
        name: fileName,
        id: hash,
        path: fullPath,
        category: category
      };

      // Check companion sidecar JSON
      const jsonPath = path.join(dir, base + '.json');
      if (fs.existsSync(jsonPath)) {
        try {
          const jsonContent = fs.readFileSync(jsonPath, 'utf8');
          const metadata = JSON.parse(jsonContent);

          if (metadata.description) def.description = metadata.description;
          if (metadata.date) def.date = metadata.date;
          if (metadata.version) def.version = metadata.version;
          if (metadata.camera) def.camera = metadata.camera;
          if (metadata.defaultTheme) def.defaultTheme = metadata.defaultTheme;
          if (metadata.grid) def.grid = metadata.grid;
          if (metadata.defaultModels) def.defaultModels = metadata.defaultModels;
          if (metadata.dropdowns) def.dropdowns = metadata.dropdowns;
        } catch (err) {
          console.error(`[definitions] Error reading sidecar for ${fileName}:`, err.message);
        }
      }

      results.push(def);
    }
  });

  return results;
}

function registerDefinitions() {
  const cncDir = path.join(__dirname, '../cnc/scripts/');
  return scanDirectory(cncDir, 'cnc');
}

// Helper: Extract inputs directly from GHX XML definition
function parseGhxInputs(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const chunks = content.split('<chunk name="Object"');

    // Index objects by InstanceGuid
    const objectsByGuid = new Map();
    for (const chunk of chunks) {
      const guidMatch = chunk.match(/<item name="InstanceGuid"[^>]*>([^<]+)<\/item>/);
      if (guidMatch) {
        objectsByGuid.set(guidMatch[1], chunk);
      }
    }

    const inputs = [];
    for (const chunk of chunks) {
      const nameMatch = chunk.match(/<item name="Name"[^>]*>([^<]+)<\/item>/);
      const nickMatch = chunk.match(/<item name="NickName"[^>]*>([^<]+)<\/item>/);
      const promptMatch = chunk.match(/<item name="Prompt"[^>]*>([^<]+)<\/item>/);
      const descMatch = chunk.match(/<item name="Description"[^>]*>([^<]+)<\/item>/);
      const sourceMatch = chunk.match(/<item name="Source"[^>]*>([^<]+)<\/item>/);

      if (nameMatch && nameMatch[1].startsWith('Get ')) {
        const typeStr = nameMatch[1].replace('Get ', '');
        const paramName = nickMatch ? nickMatch[1] : '';
        const prompt = promptMatch ? promptMatch[1] : (descMatch ? descMatch[1] : '');

        let defVal = undefined;
        let minVal = undefined;
        let maxVal = undefined;

        if (sourceMatch && objectsByGuid.has(sourceMatch[1])) {
          const srcChunk = objectsByGuid.get(sourceMatch[1]);

          // Slider?
          const sliderMatch = srcChunk.match(/<chunk name="Slider">([\s\S]*?)<\/chunk>/);
          if (sliderMatch) {
            const s = sliderMatch[1];
            const mi = s.match(/<item name="Min"[^>]*>([^<]+)<\/item>/);
            const ma = s.match(/<item name="Max"[^>]*>([^<]+)<\/item>/);
            const va = s.match(/<item name="Value"[^>]*>([^<]+)<\/item>/);
            if (mi) minVal = parseFloat(mi[1]);
            if (ma) maxVal = parseFloat(ma[1]);
            if (va) defVal = parseFloat(va[1]);
          }

          // Boolean Toggle?
          const toggleMatch = srcChunk.match(/<item name="ToggleValue" type_name="gh_bool"[^>]*>([^<]+)<\/item>/);
          if (toggleMatch) {
            defVal = toggleMatch[1].toLowerCase() === 'true';
          }

          // Panel?
          const panelMatch = srcChunk.match(/<item name="UserText"[^>]*>([^<]+)<\/item>/);
          if (panelMatch && defVal === undefined) {
            defVal = panelMatch[1];
          }
        }

        inputs.push({
          name: paramName,
          description: prompt,
          paramType: typeStr,
          default: defVal,
          minimum: minVal,
          maximum: maxVal
        });
      }
    }
    return inputs;
  } catch (err) {
    console.warn(`[definitions] Direct GHX parse failed for ${filePath}: ${err.message}`);
    return [];
  }
}

async function getParams(definitionPath) {
  console.log(`[getParams] Inspecting: ${definitionPath}`);

  // Pre-parse from GHX if available
  let localInputs = [];
  if (definitionPath.endsWith('.ghx')) {
    localInputs = parseGhxInputs(definitionPath);
  }

  // Try fetching from Rhino Compute /io
  try {
    const buffer = fs.readFileSync(definitionPath);
    const algo = buffer.toString('base64');

    const requestBody = {
      absolutetolerance: 0.01,
      angletolerance: 1.0,
      modelunits: 'Inches',
      algo: algo,
      pointer: 'md5_' + md5File.sync(definitionPath),
      cachesolve: false,
      values: []
    };

    let computeUrl = process.env.RHINO_COMPUTE_URL || 'http://localhost:6500/';
    if (!computeUrl.endsWith('/')) computeUrl += '/';
    const url = computeUrl + 'io';
    const apiKey = process.env.RHINO_COMPUTE_KEY || '';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        RhinoComputeKey: apiKey
      },
      body: JSON.stringify(requestBody),
      timeout: 8000
    });

    if (response.ok) {
      const result = await response.json();
      const rawInputs = result.inputs || result.Inputs || result.inputNames || [];
      if (rawInputs.length > 0) {
        const inputs = rawInputs.map(input => {
          const name = input.Name || input.name;
          const description = input.Description || input.description || '';
          const paramType = input.ParamType || input.paramType || 'String';

          const rawDefault = input.Default !== undefined ? input.Default : input.default;
          const rawDefaultValue = extractDefaultValue(rawDefault);
          const defaultValue = castValue(rawDefaultValue, paramType);

          const minRaw = input.Minimum !== undefined ? input.Minimum : input.minimum;
          const maxRaw = input.Maximum !== undefined ? input.Maximum : input.maximum;

          return {
            name,
            description,
            paramType,
            default: defaultValue,
            minimum: castValue(minRaw, paramType),
            maximum: castValue(maxRaw, paramType)
          };
        });

        const outputs = result.outputs || result.Outputs || result.outputNames || [];
        const description = result.description || result.Description || '';
        return { description, inputs, outputs, view: true };
      }
    }
  } catch (err) {
    console.warn(`[getParams] Remote /io inspection unavailable (${err.message}). Using local definition inputs.`);
  }

  // Fallback to local GHX inputs
  return {
    description: '',
    inputs: localInputs,
    outputs: ['GCode', 'ModifiedGcode', 'Polyline', 'BadLines', 'PointList'],
    view: true
  };
}

module.exports = { registerDefinitions, getParams };

