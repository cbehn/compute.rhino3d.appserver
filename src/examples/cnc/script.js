import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import rhino3dm from 'rhino3dm'

// --- GLOBALS ---
let currentDefinition = null;
let inputs = {};
let gcodeResult = null;
let scene, camera, renderer, controls;
let rhino;

// --- SETUP ---
const container = document.getElementById('controls-container');
const downloadBtn = document.getElementById('downloadBtn');
const definitionSelect = document.getElementById('definitionSelect');

// 1. Initialize System
init();

async function init() {
    // Load Rhino3dm
    rhino = await rhino3dm();
    console.log('Rhino3dm loaded.');

    // Initialize 3D Scene
    init3D();

    // Fetch available definitions
    try {
        const res = await fetch('/');
        const definitions = await res.json();
        
        definitions.forEach(def => {
            if (def.name.endsWith('.gh') || def.name.endsWith('.ghx')) {
                const option = document.createElement('option');
                option.value = def.name;
                option.innerText = def.name;
                definitionSelect.appendChild(option);
            }
        });
    } catch (err) {
        console.error("Failed to load definitions list", err);
    }

    // Handle Selection
    definitionSelect.addEventListener('change', (e) => {
        if(e.target.value) {
            loadDefinition(e.target.value);
        }
    });

    // Listen for View Snap events
    window.addEventListener('snap-view', (e) => {
        handleViewSnap(e.detail);
    });
}

// =========================================================
//                 LOGIC & COMMUNICATION
// =========================================================

async function loadDefinition(name) {
    currentDefinition = name;
    container.innerHTML = '<p style="text-align:center">Loading parameters...</p>';
    inputs = {}; // Reset inputs
    gcodeResult = null;
    downloadBtn.disabled = true;

    try {
        const res = await fetch(`/definition/${name}/info`);
        if (!res.ok) throw new Error("Could not find definition info");
        const metadata = await res.json();
        
        container.innerHTML = ''; 

        // Sort inputs: b64DXF first, then others
        const sortedInputs = metadata.inputs.sort((a, b) => {
            if (a.name === 'b64DXF') return -1;
            if (b.name === 'b64DXF') return 1;
            return 0;
        });

        sortedInputs.forEach(param => createControl(param));

        // Initial solve (optional, might want to wait for user input if DXF is required)
        // triggerSolve(); 
    } catch (err) {
        container.innerHTML = `<p style="color:red">Error: ${err.message}</p>`;
        console.error(err);
    }
}

async function triggerSolve() {
    if (!currentDefinition) return;

    // Wait for file input if a DXF input exists and is empty
    const dxfInput = document.querySelector('input[type="file"]');
    if (dxfInput && !inputs['b64DXF']) return;

    document.getElementById('loader').style.display = 'block';
    downloadBtn.disabled = true;
    downloadBtn.innerText = "Calculating...";

    try {
        const requestData = {
            definition: currentDefinition,
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
    const logBox = document.getElementById('log-content');
    
    // 1. Errors
    if (data.errors && data.errors.length > 0) {
        console.error("Compute Errors:", data.errors);
        logBox.innerText = "⚠️ SERVER ERRORS:\n" + data.errors.join('\n');
        logBox.style.color = "red";
        document.getElementById('log-container').open = true;
        return; 
    }

    logBox.style.color = "#333";
    logBox.innerText = "Solution completed successfully.";

    // 2. Values Check
    if (!data || !data.values || data.values.length < 1) {
        logBox.innerText += "\n(No geometry returned)";
        return;
    }

    // --- Output 0: G-Code ---
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

    // --- Geometry Processing ---
    // Clear previous generated geometry
    if (scene) {
        const toRemove = [];
        scene.traverse(child => {
            if (child.name === "generated_geo") toRemove.push(child);
        });
        toRemove.forEach(c => scene.remove(c));
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
                // Rotate to match the Work Area (XZ plane)
                line.rotation.x = -Math.PI / 2;
                scene.add(line);
            }
        });
    };

    // --- Output 1: Geometry (Black) ---
    processGeometry(1, 0x000000); 

    // --- Output 2: Geometry (Red) ---
    processGeometry(2, 0xff0000); 

    // --- Output 3: Log ---
    if (data.values.length > 3 && data.values[3].InnerTree) {
        const logBranch = Object.values(data.values[3].InnerTree)[0];
        if (logBranch && logBranch.length > 0) {
            const logLines = logBranch.map(item => {
                try { return JSON.parse(item.data); } 
                catch (e) { return item.data; }
            });
            logBox.innerText = logLines.join('\n');
        }
    }
}

// =========================================================
//                     UI BUILDER
// =========================================================

function createControl(param) {
    const wrapper = document.createElement('div');
    wrapper.className = 'control-group';
    
    // 1. DXF Upload
    if (param.name === 'b64DXF') {
        const uploadWrapper = document.createElement('div');
        uploadWrapper.className = 'upload-btn-wrapper';
        
        const btn = document.createElement('div');
        btn.className = 'btn-upload';
        btn.innerText = '📂 Upload DXF File';
        
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.dxf';
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            btn.innerText = '✅ ' + file.name;
            const reader = new FileReader();
            reader.onload = (e) => {
                inputs[param.name] = e.target.result.split(',')[1]; // Strip base64 header
                triggerSolve();
            };
            reader.readAsDataURL(file);
        });

        uploadWrapper.appendChild(btn);
        uploadWrapper.appendChild(fileInput);
        wrapper.appendChild(uploadWrapper);
    
    // 2. Integers & Numbers
    } else if (param.paramType === 'Integer' || param.paramType === 'Number') {
        const label = document.createElement('label');
        label.innerText = param.name; 
        wrapper.appendChild(label);

        const hasMinMax = (param.minimum !== null && param.maximum !== null);
        const isInt = (param.paramType === 'Integer');

        const input = document.createElement('input');
        
        if (hasMinMax) {
            // Slider
            input.type = 'range';
            input.min = param.minimum;
            input.max = param.maximum;
            input.step = isInt ? 1 : 0.1;
            input.value = param.default !== null ? param.default : param.minimum;

            const valDisplay = document.createElement('span');
            valDisplay.className = 'val-display';
            valDisplay.innerText = input.value;
            label.appendChild(valDisplay);

            input.addEventListener('input', (e) => {
                valDisplay.innerText = e.target.value;
                inputs[param.name] = Number(e.target.value);
            });
            input.addEventListener('mouseup', triggerSolve);
        } else {
            // Simple Number Box
            input.type = 'number';
            input.step = isInt ? 1 : 0.01;
            input.value = param.default !== null ? param.default : 0;
            
            input.addEventListener('change', (e) => {
                inputs[param.name] = Number(e.target.value);
                triggerSolve();
            });
        }
        
        inputs[param.name] = Number(input.value);
        wrapper.appendChild(input);

    // 3. Booleans
    } else if (param.paramType === 'Boolean') {
        const label = document.createElement('label');
        label.innerText = param.name;
        wrapper.appendChild(label);
        
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

    // 4. Other Types (Catch-all)
    } else {
        const label = document.createElement('label');
        label.innerText = param.name;
        wrapper.appendChild(label);

        const msg = document.createElement('div');
        msg.className = 'coming-soon';
        msg.innerText = `${param.paramType} input coming soon`;
        wrapper.appendChild(msg);
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
//                  3D VISUALIZATION
// =========================================================

function init3D() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe0e0e0); 
    // scene.fog = new THREE.Fog(0xe0e0e0, 50, 200);

    // Setup Camera
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    // Initial ISO View
    camera.position.set(40, 60, 60); 

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    
    // --- WORK AREA ---
    // 48 x 96 box. Standard CNC axis: X is width, Y is length.
    // ThreeJS defaults Y Up. Rhino defaults Z Up.
    // The geometry processing rotates -90 X, putting Rhino XY onto Three XZ.
    // So we build the work area on the XZ plane.
    
    // 1. The Bed (Light Blue Box)
    const bedGeo = new THREE.BoxGeometry(48, 1, 96);
    const bedMat = new THREE.MeshLambertMaterial({ 
        color: 0xadd8e6, 
        transparent: true, 
        opacity: 0.8 
    });
    const bed = new THREE.Mesh(bedGeo, bedMat);
    bed.position.y = -0.5; // Top face is at y=0
    scene.add(bed);

    // 2. The Outline (Edges)
    const edges = new THREE.EdgesGeometry(bedGeo);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x4682b4 }));
    line.position.copy(bed.position);
    scene.add(line);

    // Lights
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444);
    hemiLight.position.set(0, 100, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(50, 50, 0);
    scene.add(dirLight);

    window.addEventListener('resize', onWindowResize, false);
    animate();
}

function handleViewSnap(view) {
    const dist = 80; // Distance for camera
    const center = new THREE.Vector3(0,0,0);
    
    switch(view) {
        case 'top':
            camera.position.set(0, dist, 0);
            break;
        case 'front':
            camera.position.set(0, 0, dist);
            break;
        case 'back':
            camera.position.set(0, 0, -dist);
            break;
        case 'left':
            camera.position.set(-dist, 0, 0);
            break;
        case 'right':
            camera.position.set(dist, 0, 0);
            break;
        case 'bottom':
            camera.position.set(0, -dist, 0);
            break;
        case 'iso':
        default:
            camera.position.set(40, 60, 60);
            break;
    }
    camera.lookAt(center);
    controls.update();
}

function onWindowResize() {
    // Account for sidebar width (300px)
    const width = window.innerWidth - 300; 
    const height = window.innerHeight;
    
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
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