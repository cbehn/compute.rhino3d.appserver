import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { Rhino3dmLoader } from 'three/examples/jsm/loaders/3DMLoader'
import rhino3dm from 'rhino3dm'

// --- CONFIGURATION ---
const DEFINITION_NAME = 'cncProfiler.gh';

// --- GLOBALS ---
let inputs = {};
let gcodeResult = null;
let scene, camera, renderer, controls;
let doc; // To hold the rhino document

// --- SETUP ---
const container = document.getElementById('controls-container');
const downloadBtn = document.getElementById('downloadBtn');

// 1. Initialize Rhino3dm
const rhino = await rhino3dm();
console.log('Rhino3dm loaded.');

// 2. Initialize 3D Scene
init3D();

// 3. Initialize UI & Definition
initDefinition();


// =========================================================
//                 LOGIC & COMMUNICATION
// =========================================================

async function initDefinition() {
    try {
        const res = await fetch(`/definition/${DEFINITION_NAME}/info`);
        if (!res.ok) throw new Error("Could not find definition info");
        const metadata = await res.json();
        
        container.innerHTML = ''; 
        metadata.inputs.forEach(param => createControl(param));
    } catch (err) {
        container.innerHTML = `<p style="color:red">Error: ${err.message}</p>`;
        console.error(err);
    }
}

async function triggerSolve() {
    // Wait for file input if needed
    if (document.querySelector('input[type="file"]') && !inputs['b64DXF']) return;

    document.getElementById('loader').style.display = 'block';
    downloadBtn.disabled = true;
    downloadBtn.innerText = "Calculating...";

    try {
        const requestData = {
            definition: DEFINITION_NAME,
            inputs: inputs
        };

        const res = await fetch('/solve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        });

        const data = await res.json();
        handleResponse(data);

    } catch (err) {
        console.error(err);
        downloadBtn.innerText = "Error (Check Console)";
    } finally {
        document.getElementById('loader').style.display = 'none';
    }
}

function handleResponse(data) {
    // 1. CHECK FOR GLOBAL ERRORS (The missing link!)
    if (data.errors && data.errors.length > 0) {
        console.error("Compute Errors:", data.errors);
        
        const logBox = document.getElementById('log-content');
        if (logBox) {
            logBox.innerText = "⚠️ SERVER ERRORS:\n" + data.errors.join('\n');
            logBox.style.color = "red"; // Make it visible
            
            // Force open the log box
            const details = document.getElementById('log-container');
            if (details) details.open = true;
        }
        
        // Even if there are errors, we might have partial values, 
        // but usually we want to stop here or warn the user.
        return; 
    }

    // Reset log box style if no errors
    const logBox = document.getElementById('log-content');
    if(logBox) {
        logBox.style.color = "#333";
        logBox.innerText = "Solution completed without server errors.";
    }

    // 2. SAFETY CHECK: Do we have values?
    if (!data || !data.values || data.values.length < 1) {
        if(logBox) logBox.innerText += "\n(But no geometry was returned)";
        return;
    }

    // --- 3. HANDLE G-CODE (Output 0) ---
    if (data.values[0] && data.values[0].InnerTree) {
        const gcodeBranch = Object.values(data.values[0].InnerTree)[0];
        if (gcodeBranch && gcodeBranch.length > 0) {
            try {
                gcodeResult = gcodeBranch.map(item => JSON.parse(item.data)).join('\n');
                downloadBtn.disabled = false;
                downloadBtn.innerText = "Download GCode";
            } catch (e) {
                console.error("Error parsing GCode:", e);
            }
        }
    }

    // --- 4. HANDLE GEOMETRY (Output 1 & 2) ---
    if (scene) {
        scene.traverse(child => {
            if (child.name === "generated_geo") scene.remove(child);
        });
    }

    const processGeometry = (outputIndex, colorHex) => {
        if (data.values.length <= outputIndex) return;
        if (!data.values[outputIndex].InnerTree) return;

        const branch = Object.values(data.values[outputIndex].InnerTree)[0];
        if (!branch) return;

        const material = new THREE.LineBasicMaterial({ color: colorHex });
        const loader = new THREE.BufferGeometryLoader();

        branch.forEach(item => {
            const rhinoObject = decodeItem(item);
            if (rhinoObject) {
                const geometry = loader.parse(rhinoObject.toThreejsJSON());
                const line = new THREE.Line(geometry, material);
                line.name = "generated_geo";
                line.rotation.x = -Math.PI / 2;
                scene.add(line);
            }
        });
    };

    processGeometry(1, 0x000000); // Output 1
    processGeometry(2, 0xff0000); // Output 2

    // --- 5. HANDLE LOG (Output 3) ---
    // If we made it this far, we check the standard log output
    if (data.values.length > 3 && data.values[3].InnerTree) {
        const logBranch = Object.values(data.values[3].InnerTree)[0];

        if (logBranch && logBranch.length > 0) {
            const logLines = logBranch.map(item => {
                try { return JSON.parse(item.data); } 
                catch (e) { return item.data; }
            });
            
            // Append to whatever status we already wrote
            logBox.innerText = logLines.join('\n');
            
            const details = document.getElementById('log-container');
            if (details && logBox.innerText.toLowerCase().includes("error")) {
                details.open = true;
            }
        }
    }
}

// =========================================================
//                     UI BUILDER
// =========================================================

function createControl(param) {
    const wrapper = document.createElement('div');
    wrapper.className = 'control-group';
    const label = document.createElement('label');
    label.innerText = param.name; 
    wrapper.appendChild(label);

    if (param.name === 'b64DXF') {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.dxf';
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                inputs[param.name] = e.target.result.split(',')[1]; // Strip header
                triggerSolve();
            };
            reader.readAsDataURL(file);
        });
        wrapper.appendChild(fileInput);
    } else if (param.paramType === 'Boolean') {
        const toggle = document.createElement('div');
        toggle.className = 'toggle';
        toggle.innerText = 'OFF';
        toggle.onclick = () => {
            inputs[param.name] = !inputs[param.name];
            toggle.classList.toggle('active');
            toggle.innerText = inputs[param.name] ? 'ON' : 'OFF';
            triggerSolve();
        };
        inputs[param.name] = false; 
        wrapper.appendChild(toggle);
    } else if (param.paramType === 'Integer' || param.paramType === 'Number') {
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = param.minimum !== null ? param.minimum : 0;
        slider.max = param.maximum !== null ? param.maximum : 100;
        slider.step = param.paramType === 'Integer' ? 1 : 0.1;
        slider.value = param.default !== null ? param.default : slider.min;
        
        const valDisplay = document.createElement('span');
        valDisplay.className = 'val-display';
        valDisplay.innerText = slider.value;
        label.appendChild(valDisplay);

        slider.addEventListener('mouseup', () => triggerSolve());
        slider.addEventListener('input', (e) => {
            valDisplay.innerText = e.target.value;
            inputs[param.name] = Number(e.target.value);
        });
        inputs[param.name] = Number(slider.value);
        wrapper.appendChild(slider);
    }
    container.appendChild(wrapper);
}

downloadBtn.onclick = () => {
    if (!gcodeResult) return;
    const blob = new Blob([gcodeResult], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'CNCJob.gcode';
    link.click();
};

// =========================================================
//                  3D VISUALIZATION HELPERS
// =========================================================

function init3D() {
    // Use a light background so we can see the BLACK lines
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0); 

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 10000);
    camera.position.set(0, 0, 100); // Top Down-ish view

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    
    // Add grid for reference
    const grid = new THREE.GridHelper(2000, 20);
    grid.rotation.x = Math.PI / 2; // Lay flat
    scene.add(grid);

    window.addEventListener('resize', onWindowResize, false);
    animate();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

function decodeItem(item) {
    const data = JSON.parse(item.data);
    if (typeof data === 'object') {
        return rhino.CommonObject.decode(data);
    }
    return null;
}
