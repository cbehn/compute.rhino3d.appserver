const logEl = document.getElementById('log');

// --- UTILS ---
function log(msg) {
    const ts = new Date().toLocaleTimeString();
    const line = `[${ts}] ${msg}`;
    logEl.innerText = line + '\n' + logEl.innerText;
    console.log(line);
}

function setStatus(id, state, msg, detail = '') {
    const card = document.getElementById(id);
    // Remove old classes
    card.classList.remove('pass', 'fail', 'wait');
    // Add new class
    card.classList.add(state);
    
    card.querySelector('.status').innerText = msg;
    if (detail) card.querySelector('.details').innerHTML = detail;
    
    // Log failures
    if (state === 'fail') log(`ERROR [${id}]: ${msg} - ${detail}`);
}

// --- MAIN TESTS ---

async function runTests() {
    log("Starting system check...");
    
    // --- 1. HEALTH CHECK ---
    setStatus('card-health', 'wait', 'Checking...');
    try {
        const start = Date.now();
        const res = await fetch('/healthcheck'); // AppServer standard endpoint
        const latency = Date.now() - start;
        
        if (res.ok) {
            const text = await res.text();
            setStatus('card-health', 'pass', 'Healthy', `Response: "${text}"`);
            
            // --- 7. PING (Re-use latency) ---
            setStatus('card-ping', 'pass', `${latency} ms`, 'Roundtrip time');
        } else {
            throw new Error(`${res.status} ${res.statusText}`);
        }
    } catch (e) {
        setStatus('card-health', 'fail', 'Failed', e.message);
        setStatus('card-ping', 'fail', 'Timeout');
    }

    // --- 2. FILES LIST ---
    setStatus('card-files', 'wait', 'Fetching...');
    try {
        // CHANGED: Fetch from root ('/') to match CNC page logic
        const res = await fetch('/');
        const definitions = await res.json();
        
        const select = document.getElementById('file-select');
        select.innerHTML = '';
        
        // Filter: Match CNC logic (check extensions)
        const validFiles = definitions.filter(def => def.name.endsWith('.gh') || def.name.endsWith('.ghx'));

        if (validFiles.length > 0) {
            validFiles.forEach(def => {
                const opt = document.createElement('option');
                // Use def.name because the endpoint returns objects: { name: "file.gh" }
                opt.value = def.name;
                opt.innerText = def.name;
                select.appendChild(opt);
            });
            setStatus('card-files', 'pass', 'Found Files', `${validFiles.length} definitions found.`);
            select.disabled = false;
            document.getElementById('btn-load-interface').disabled = false;
            
            // Auto-trigger interface test for first file
            testInterface(validFiles[0].name);
        } else {
            setStatus('card-files', 'wait', 'No Files', 'No matching .gh/.ghx definitions found.');
        }
    } catch (e) {
        setStatus('card-files', 'fail', 'Error', e.message);
    }

    // --- 6. API KEY CHECK ---
    setStatus('card-auth', 'wait', 'Verifying...');
    try {
        const res = await fetch('/api/health/check-auth');
        const data = await res.json();
        if (data.status === 'pass') {
            setStatus('card-auth', 'pass', 'Authenticated', 'Key is valid.');
        } else {
            setStatus('card-auth', 'fail', 'Invalid Key', data.message);
        }
    } catch (e) {
        setStatus('card-auth', 'fail', 'Error', e.message);
    }

    // --- 8. VERSION ---
    try {
        const res = await fetch('/version');
        const data = await res.json();
        setStatus('card-version', 'pass', 'v' + data.version, `Git SHA: ${data.git_sha}\nRhino: ${data.rhino}`);
    } catch (e) {
        setStatus('card-version', 'fail', 'Unknown', e.message);
    }
}

// --- 3 & 4. INTERFACE & VALIDATION ---
async function testInterface(filename) {
    if (!filename) filename = document.getElementById('file-select').value;
    
    setStatus('card-interface', 'wait', 'Loading...');
    setStatus('card-validation', 'wait', 'Pending...');
    log(`Loading interface for: ${filename}`);

    try {
        const res = await fetch(`/definition/${filename}/info`);
        if (!res.ok) throw new Error("Info endpoint failed");
        
        const info = await res.json();
        setStatus('card-interface', 'pass', 'Loaded', `Inputs: ${info.inputs.length}<br>Outputs: ${info.outputs.length}`);

        // VALIDATION CHECK
        // Check for 'b64DXF'
        const hasDXF = info.inputs.some(i => i.name === 'b64DXF');
        const outputCount = info.outputs.length;
        
        let details = "";
        let passed = true;

        if (hasDXF) {
            details += "✅ 'b64DXF' input found<br>";
        } else {
            details += "❌ Missing 'b64DXF' input<br>";
            passed = false;
        }

        if (outputCount === 4) {
            details += "✅ 4 outputs found";
        } else {
            details += `⚠️ Found ${outputCount} outputs (expected 4)`;
            // Make this a warning (yellow) or fail depending on strictness
            if(outputCount === 0) passed = false; 
        }

        if (passed && outputCount === 4) {
            setStatus('card-validation', 'pass', 'Passed', details);
        } else if (passed) {
             setStatus('card-validation', 'wait', 'Warning', details);
        } else {
            setStatus('card-validation', 'fail', 'Failed', details);
        }

    } catch (e) {
        setStatus('card-interface', 'fail', 'Error', e.message);
        setStatus('card-validation', 'fail', 'Skipped', 'Could not load definition info.');
    }
}

document.getElementById('btn-load-interface').onclick = () => testInterface();
document.getElementById('file-select').onchange = (e) => testInterface(e.target.value);

// --- 5. HOPS SOLVE ---
async function testSolve() {
    setStatus('card-hops', 'wait', 'Testing Solve...');
    log("Testing Hops Solve endpoint...");

    try {
        // 1. Fetch the test file
        const resFile = await fetch('/pages/health/files/hops_solve.json');
        if (!resFile.ok) throw new Error(`Failed to fetch test data: ${resFile.statusText}`);
        const solveData = await resFile.json();

        // 2. Send the data to the /solve endpoint
        const resSolve = await fetch('/solve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(solveData)
        });

        if (!resSolve.ok) {
            const errorText = await resSolve.text();
            throw new Error(`Solve request failed: ${resSolve.status} ${errorText}`);
        }

        const result = await resSolve.json();

        // 3. Validate the response
        if (result.values && result.values.length > 0) {
            setStatus('card-hops', 'pass', 'Success', `Solve completed with ${result.values.length} output values.`);
        } else {
            throw new Error('Solve completed but returned no values.');
        }

    } catch (e) {
        setStatus('card-hops', 'fail', 'Error', e.message);
    }
}

// --- 6. HOPS IO ---
async function testIo() {
    setStatus('card-io', 'wait', 'Testing IO...');
    log("Testing Hops IO endpoint...");

    try {
        // 1. Fetch the test file
        const resFile = await fetch('/pages/health/files/hops_io.json');
        if (!resFile.ok) throw new Error(`Failed to fetch test data: ${resFile.statusText}`);
        const ioData = await resFile.json();

        // 2. Send the data to the /io endpoint (assuming it exists)
        // This requires an /io endpoint on the app server that forwards to Compute
        const resIo = await fetch('/io', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ioData)
        });

        if (!resIo.ok) {
            const errorText = await resIo.text();
            throw new Error(`IO request failed: ${resIo.status} ${errorText}`);
        }

        const result = await resIo.json();

        // 3. Validate the response (structure may vary)
        if (result.Inputs && result.Outputs) {
            setStatus('card-io', 'pass', 'Success', `IO returned ${result.Inputs.length} Inputs and ${result.Outputs.length} Outputs.`);
        } else {
            throw new Error('IO response is missing expected Input/Output properties.');
        }

    } catch (e) {
        setStatus('card-io', 'fail', 'Error', e.message);
    }
}


// Start on load
runTests();
testSolve();
testIo();