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
    if (!card) return;
    card.classList.remove('pass', 'fail', 'wait', 'unknown');
    card.classList.add(state);
    card.querySelector('.status').innerText = msg;
    if (detail) card.querySelector('.details').innerHTML = detail;
    if (state === 'fail') log(`ERROR [${id}]: ${msg}`);
}

// --- 1. CORE CHECKS (Health & Network) ---
async function checkHealth() {
    setStatus('card-health', 'wait', 'Checking...');
    setStatus('card-azure', 'wait', 'Inferring...');
    setStatus('card-ping', 'wait', 'Measuring...');

    // Reset dependent buttons
    document.getElementById('btn-load-interface').disabled = true;
    document.getElementById('btn-run-hops').disabled = true;

    // --- Step A: Measure Client <-> App Server Latency ---
    // We use /version because it is a fast, local route on the App Server
    let tStart = Date.now();
    let clientAppMs = null;
    try {
        const vRes = await fetch('/version');
        if(vRes.ok) clientAppMs = Date.now() - tStart;
    } catch(e) {}

    // --- Step B: Measure End-to-End Latency (Client <-> App <-> Compute) ---
    tStart = Date.now();
    let e2eMs = null;
    
    try {
        const res = await fetch('/healthcheck');
        if(res.ok) {
            e2eMs = Date.now() - tStart;
            const text = await res.text();
            
            // Box 1: Health Pass
            setStatus('card-health', 'pass', 'Healthy', `Response: "${text}"\nCode: ${res.status}`);
            
            // Box 2: Azure Pass
            setStatus('card-azure', 'pass', 'Running', 'Service is responding, so VM is ON.');

            // Success: Trigger Dependents
            checkComputeDependents();
        } else {
            throw new Error(`${res.status} ${res.statusText}`);
        }
    } catch (e) {
        // Box 1: Health Fail
        setStatus('card-health', 'fail', 'Unreachable', e.message);
        
        // Box 2: Azure Unknown
        setStatus('card-azure', 'unknown', 'Unknown', 'Health check failed.\nVM may be Off or Starting.');
        
        // Dependents remain disabled
    }

    // --- Step C: Update Box 9 (Latency) ---
    
    // Inferred App <-> Compute Latency
    let appComputeMs = null;
    if (clientAppMs !== null && e2eMs !== null) {
        appComputeMs = e2eMs - clientAppMs;
        if (appComputeMs < 0) appComputeMs = 0; // Prevent negative if clocks/network vary slightly
    }

    const pingDetails = `
        <div style="display:flex; justify-content:space-between;"><span>1. Client ↔ App:</span> <span>${clientAppMs ? clientAppMs+' ms' : '❌'}</span></div>
        <div style="display:flex; justify-content:space-between;"><span>2. App ↔ Compute:</span> <span>${appComputeMs!==null ? '~'+appComputeMs+' ms' : '❌'}</span></div>
        <div style="display:flex; justify-content:space-between; border-top:1px solid #555; margin-top:5px; padding-top:5px;"><span>3. End-to-End:</span> <span>${e2eMs ? e2eMs+' ms' : '❌'}</span></div>
    `;

    if (clientAppMs && e2eMs) {
        setStatus('card-ping', 'pass', 'Good', pingDetails);
    } else if (clientAppMs || e2eMs) {
        setStatus('card-ping', 'wait', 'Partial', pingDetails);
    } else {
        setStatus('card-ping', 'fail', 'Failed', pingDetails);
    }
}

// --- 2. STATIC CHECKS (Run on Start) ---

async function checkFiles() {
    setStatus('card-files', 'wait', 'Fetching...');
    try {
        const res = await fetch('/api/definitions');
        if (!res.ok) throw new Error(`API ${res.status}`);
        
        const definitions = await res.json();
        const select = document.getElementById('file-select');
        select.innerHTML = '';
        
        const validFiles = definitions.filter(def => def.name.endsWith('.gh') || def.name.endsWith('.ghx'));

        if (validFiles.length > 0) {
            validFiles.forEach(def => {
                const opt = document.createElement('option');
                opt.value = def.name;
                opt.innerText = def.name;
                select.appendChild(opt);
            });
            setStatus('card-files', 'pass', 'Found Files', `${validFiles.length} definitions available.`);
            select.disabled = false;
        } else {
            setStatus('card-files', 'wait', 'No Files', 'No .gh files found in /files');
        }
    } catch (e) {
        setStatus('card-files', 'fail', 'Error', e.message);
    }
}

async function checkVersion() {
    setStatus('card-version', 'wait', 'Fetching...');
    try {
        const res = await fetch('/version');
        const text = await res.text(); // Get text first to debug "Unexpected token"

        try {
            const data = JSON.parse(text); // Try parse
            setStatus('card-version', 'pass', 'v' + data.version, `SHA: ${data.git_sha}\nRhino: ${data.rhino}`);
        } catch (parseErr) {
            // This catches the "<!DOCTYPE html>" error
            console.error("Version parse error:", text);
            setStatus('card-version', 'fail', 'Parse Error', 'Server returned HTML instead of JSON.\n(Route may be erroring)');
        }
    } catch (e) {
        setStatus('card-version', 'fail', 'Error', e.message);
    }
}

async function checkAppLogic() {
    setStatus('card-appstate', 'wait', 'Checking...');
    try {
        const res = await fetch('/azure/status');
        if(res.ok) {
            const data = await res.json();
            if(data.appState) {
                const { minutesSinceActive, isVmActionInProgress } = data.appState;
                setStatus('card-appstate', 'pass', 'Active', 
                    `Idle: ${minutesSinceActive} mins\nBusy Flag: ${isVmActionInProgress}`);
            } else {
                setStatus('card-appstate', 'unknown', 'No Data', 'App state missing from response');
            }
        } else {
            setStatus('card-appstate', 'fail', 'Error', `Status: ${res.status}`);
        }
    } catch (e) {
        setStatus('card-appstate', 'fail', 'Error', e.message);
    }
}

// --- 3. DEPENDENT CHECKS (Run only if Health OK) ---

function checkComputeDependents() {
    // Enable Buttons
    document.getElementById('btn-load-interface').disabled = false;
    document.getElementById('btn-run-hops').disabled = false;
    
    // Trigger Auto-Checks
    checkAuth();
    
    // Optional: Auto-load interface for first file if available
    const select = document.getElementById('file-select');
    if (select.options.length > 0 && select.value !== 'Loading...') {
        testInterface(select.value);
    }
}

async function checkAuth() {
    setStatus('card-auth', 'wait', 'Verifying...');
    try {
        const res = await fetch('/api/health/check-auth');
        const data = await res.json();
        if (data.status === 'pass') {
            setStatus('card-auth', 'pass', 'Authenticated', 'Key accepted.');
        } else {
            setStatus('card-auth', 'fail', 'Invalid', data.message);
        }
    } catch (e) {
        setStatus('card-auth', 'fail', 'Error', e.message);
    }
}

async function testInterface(filename) {
    if (!filename) filename = document.getElementById('file-select').value;
    if (!filename || filename === 'Loading...') return;

    setStatus('card-interface', 'wait', 'Loading...');
    setStatus('card-validation', 'wait', 'Pending...');

    try {
        const res = await fetch(`/definition/${filename}/info`);
        if (!res.ok) throw new Error("Request Failed");
        
        const info = await res.json();
        setStatus('card-interface', 'pass', 'Loaded', `Inputs: ${info.inputs.length}\nOutputs: ${info.outputs.length}`);

        // Validation
        const hasDXF = info.inputs.some(i => i.name === 'b64DXF');
        const count = info.outputs.length;
        let details = (hasDXF ? "✅ b64DXF found\n" : "❌ No b64DXF\n");
        details += (count === 4 ? "✅ 4 Outputs" : `⚠️ ${count} Outputs`);
        
        const state = (hasDXF && count === 4) ? 'pass' : 'wait';
        setStatus('card-validation', state, (state==='pass'?'Passed':'Warning'), details);

    } catch (e) {
        setStatus('card-interface', 'fail', 'Error', e.message);
        setStatus('card-validation', 'fail', 'Skipped', 'Metadata load failed');
    }
}

async function testSolve() {
    setStatus('card-hops', 'wait', 'Simulating...');
    try {
        const resFile = await fetch('files/hops_solve.json');
        if (!resFile.ok) throw new Error("Test file missing");
        const solveData = await resFile.json();

        const res = await fetch('/solve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(solveData)
        });

        if (!res.ok) throw new Error(`Status ${res.status}`);
        const result = await res.json();
        
        if (result.values && result.values.length > 0) {
            setStatus('card-hops', 'pass', 'Success', `Returned ${result.values.length} values`);
        } else {
            throw new Error('No values returned');
        }
    } catch (e) {
        setStatus('card-hops', 'fail', 'Failed', e.message);
    }
}

// --- INIT ---

// Independent Checks (Run Immediately)
checkFiles();
checkVersion();
checkAppLogic();

// Core Check (Runs Dependents on Success)
checkHealth();

// --- BUTTONS ---
document.getElementById('btn-load-interface').onclick = (e) => { e.stopPropagation(); testInterface(); };
document.getElementById('file-select').onchange = (e) => testInterface(e.target.value);
document.getElementById('btn-run-hops').onclick = (e) => { e.stopPropagation(); testSolve(); };

document.getElementById('btn-wake').onclick = async function() {
    this.disabled = true; this.innerText = "Sending...";
    try {
        const res = await fetch('/wakeup', { method: 'POST' });
        const data = await res.json();
        alert(data.message);
        checkHealth(); // Re-poll
    } catch (e) { alert(e.message); }
    finally { this.disabled = false; this.innerText = "Wake Up"; }
};

document.getElementById('btn-stop').onclick = () => alert("Not supported by current API.");