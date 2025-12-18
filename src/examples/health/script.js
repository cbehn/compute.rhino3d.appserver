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
        const res = await fetch('/api/health/files');
        const files = await res.json();
        
        const select = document.getElementById('file-select');
        select.innerHTML = '';
        
        if (files.length > 0) {
            files.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f;
                opt.innerText = f;
                select.appendChild(opt);
            });
            setStatus('card-files', 'pass', 'Found Files', `${files.length} definitions found.`);
            select.disabled = false;
            document.getElementById('btn-load-interface').disabled = false;
            
            // Auto-trigger interface test for first file
            testInterface(files[0]);
        } else {
            setStatus('card-files', 'wait', 'No Files', 'Directory is empty or path incorrect.');
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

// --- 5. HOPS SIMULATION ---
async function runHopsTest() {
    setStatus('card-hops', 'wait', 'Simulating...');
    log("Sending Hops Simulation Request...");
    try {
        const res = await fetch('/api/health/test-hops', { method: 'POST' });
        const data = await res.json();
        
        if (data.status === 'pass') setStatus('card-hops', 'pass', 'Success', data.message);
        else if (data.status === 'yellow') setStatus('card-hops', 'wait', 'Missing Files', data.message);
        else setStatus('card-hops', 'fail', 'Failed', data.message);
        
    } catch (e) {
        setStatus('card-hops', 'fail', 'Network Error', e.message);
    }
}

// Start on load
runTests();