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

        // 1. Check if the network request failed (e.g., 500 Error)
        if (!res.ok) {
            // Read the text body of the 500 error to see the real reason
            const errorText = await res.text(); 
            throw new Error(errorText);
        }

        const data = await res.json();

        // 2. Check if Grasshopper returned a calculation error
        if (data.values === undefined && data.errors) {
             throw new Error("Grasshopper Error: " + JSON.stringify(data.errors));
        }

        handleResponse(data);

    } catch (err) {
        console.error("Solve Failed:", err);
        
        downloadBtn.innerText = "Error (Check Log)";

        // 3. Display the error in your new Debug Log UI
        const logContent = document.getElementById('log-content');
        if (logContent) {
            logContent.innerHTML = `<div style="color:red; font-weight:bold;">
                ❌ ERROR: ${err.message}
            </div>`;
            // Force the details panel open so the user sees it
            const logContainer = document.getElementById('log-container');
            if (logContainer) logContainer.open = true;
        }

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
                
                // Enable Button
                downloadBtn.disabled = false;
                downloadBtn.innerText = "Download GCode";

                // --- NEW: Display GCode ---
                const previewBox = document.getElementById('gcode-preview');
                previewBox.style.display = 'block';
                previewBox.innerText = gcodeResult; // Show the text!

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
    
    // Setup Camera (Standard ISO View)
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(40, 60, 60); 

    // Adjust renderer size
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth - 300, window.innerHeight); 
    renderer.shadowMap.enabled = true;
    
    const canvasContainer = document.getElementById('canvas-container');
    canvasContainer.innerHTML = ''; 
    canvasContainer.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    
    // --- 1. COORDINATE SYSTEM FIX ---
    // Rhino X = Three X (Red)
    // Rhino Y = Three -Z (Green) -> This makes it go "Up" the screen
    // Rhino Z = Three Y (Blue)

    // --- 2. CUSTOM GRID (6 units margin) ---
    // Box is 48 wide (X) by 96 tall (Rhino Y / Three -Z)
    // Grid X: -6 to 54
    // Grid Z: +6 to -102 (Remember Z is negative!)
    
    const gridColor = 0x888888;
    const points = [];

    // Vertical lines (Scanning along X)
    for (let x = -6; x <= 54; x += 1) {
        // Line from Z=6 to Z=-102
        points.push(new THREE.Vector3(x, 0, 6));
        points.push(new THREE.Vector3(x, 0, -102));
    }

    // Horizontal lines (Scanning along Z)
    for (let z = 6; z >= -102; z -= 1) {
        // Line from X=-6 to X=54
        points.push(new THREE.Vector3(-6, 0, z));
        points.push(new THREE.Vector3(54, 0, z));
    }

    const gridGeo = new THREE.BufferGeometry().setFromPoints(points);
    const gridMat = new THREE.LineBasicMaterial({ color: gridColor, opacity: 0.4, transparent: true });
    const grid = new THREE.LineSegments(gridGeo, gridMat);
    scene.add(grid);

    // --- 3. WORK AREA BORDER ---
    // 48 x 96 Rectangle
    const rectPoints = [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(48, 0, 0),    // Right (X)
        new THREE.Vector3(48, 0, -96),  // Right & Up (-Z)
        new THREE.Vector3(0, 0, -96),   // Up (-Z)
        new THREE.Vector3(0, 0, 0)      // Close Loop
    ];
    const borderGeo = new THREE.BufferGeometry().setFromPoints(rectPoints);
    const borderMat = new THREE.LineBasicMaterial({ color: 0x2196F3, linewidth: 2 });
    const border = new THREE.Line(borderGeo, borderMat);
    border.position.y = 0.05; // Slightly lift to avoid z-fighting with grid
    scene.add(border);

    // --- 4. AXIS ARROWS & LABELS ---
    const origin = new THREE.Vector3(0, 0, 0);
    const arrowLength = 12;
    const headLength = 3;
    const headWidth = 1.5;

    // X-Axis (Red)
    const dirX = new THREE.Vector3(1, 0, 0);
    const arrowX = new THREE.ArrowHelper(dirX, origin, arrowLength, 0xff0000, headLength, headWidth);
    scene.add(arrowX);
    createLabel("X", new THREE.Vector3(arrowLength + 2, 0, 0), "red");

    // Y-Axis (Rhino Y is Three -Z) (Green)
    const dirY = new THREE.Vector3(0, 0, -1);
    const arrowY = new THREE.ArrowHelper(dirY, origin, arrowLength, 0x00ff00, headLength, headWidth);
    scene.add(arrowY);
    createLabel("Y", new THREE.Vector3(0, 0, -arrowLength - 2), "green");

    // Z-Axis (Rhino Z is Three Y) (Blue)
    const dirZ = new THREE.Vector3(0, 1, 0);
    const arrowZ = new THREE.ArrowHelper(dirZ, origin, arrowLength, 0x0000ff, headLength, headWidth);
    scene.add(arrowZ);
    createLabel("Z", new THREE.Vector3(0, arrowLength + 2, 0), "blue");


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

/**
 * Helper to create text labels using a 2D Canvas
 */
function createLabel(text, position, colorStr) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    ctx.font = 'Bold 48px Arial';
    ctx.fillStyle = colorStr;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 32, 32);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(material);
    
    sprite.position.copy(position);
    sprite.scale.set(5, 5, 1); // Scale the sprite to be visible
    scene.add(sprite);
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