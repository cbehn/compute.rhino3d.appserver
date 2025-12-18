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

init();

async function init() {
    // Load Rhino3dm
    rhino = await rhino3dm();
    console.log('Rhino3dm loaded.');

    init3D();

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

    definitionSelect.addEventListener('change', (e) => {
        if(e.target.value) {
            loadDefinition(e.target.value);
        }
    });

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
    inputs = {}; 
    gcodeResult = null;
    downloadBtn.disabled = true;

    try {
        const res = await fetch(`/definition/${name}/info`);
        if (!res.ok) throw new Error("Could not find definition info");
        const metadata = await res.json();
        
        container.innerHTML = ''; 

        const sortedInputs = metadata.inputs.sort((a, b) => {
            if (a.name === 'b64DXF') return -1;
            if (b.name === 'b64DXF') return 1;
            return 0;
        });

        sortedInputs.forEach(param => createControl(param));
    } catch (err) {
        container.innerHTML = `<p style="color:red">Error: ${err.message}</p>`;
        console.error(err);
    }
}

async function triggerSolve() {
    if (!currentDefinition) return;

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

        if (!res.ok) {
            const errorText = await res.text(); 
            throw new Error(errorText);
        }

        const data = await res.json();

        if (data.values === undefined && data.errors) {
             throw new Error("Grasshopper Error: " + JSON.stringify(data.errors));
        }

        handleResponse(data);

    } catch (err) {
        console.error("Solve Failed:", err);
        downloadBtn.innerText = "Error (Check Log)";
        const logContent = document.getElementById('log-content');
        if (logContent) {
            logContent.innerHTML = `<div style="color:red; font-weight:bold;">❌ ERROR: ${err.message}</div>`;
            const logContainer = document.getElementById('log-container');
            if (logContainer) logContainer.open = true;
        }
    } finally {
        document.getElementById('loader').style.display = 'none';
    }
}

function curveToThree(rhinoCurve, material) {
    const points = [];
    const domain = rhinoCurve.domain;
    const count = 100; 
    
    for (let i = 0; i <= count; i++) {
        const t = domain[0] + (i / count) * (domain[1] - domain[0]);
        const pt = rhinoCurve.pointAt(t);
        points.push(new THREE.Vector3(pt[0], pt[1], pt[2]));
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);
    return line;
}

function handleResponse(data) {
    const logBox = document.getElementById('log-content');
    
    if (data.errors && data.errors.length > 0) {
        logBox.innerText = "⚠️ SERVER ERRORS:\n" + data.errors.join('\n');
        logBox.style.color = "red";
        document.getElementById('log-container').open = true;
        return; 
    }

    logBox.style.color = "#333";
    logBox.innerText = "Solution completed successfully.";

    if (!data || !data.values || data.values.length < 1) {
        logBox.innerText += "\n(No geometry returned)";
        return;
    }

    if (data.values[0] && data.values[0].InnerTree) {
        const gcodeBranch = Object.values(data.values[0].InnerTree)[0];
        if (gcodeBranch && gcodeBranch.length > 0) {
            try {
                gcodeResult = gcodeBranch.map(item => JSON.parse(item.data)).join('\n');
                downloadBtn.disabled = false;
                downloadBtn.innerText = "Download GCode";
                const previewBox = document.getElementById('gcode-preview');
                previewBox.style.display = 'block';
                previewBox.innerText = gcodeResult;
            } catch (e) { console.error("Error parsing GCode:", e); }
        }
    }

    if (scene) {
        const toRemove = [];
        scene.traverse(child => { if (child.name === "generated_geo") toRemove.push(child); });
        toRemove.forEach(c => scene.remove(c));
    }

    const processGeometry = (outputIndex, colorHex) => {
        if (data.values.length <= outputIndex) return;
        const tree = data.values[outputIndex].InnerTree;
        if (!tree) return;

        const material = new THREE.LineBasicMaterial({ color: colorHex });
        
        Object.values(tree).forEach(branch => {
            branch.forEach(item => {
                const rhinoObject = decodeItem(item);
                if (!rhinoObject) return;

                let threeObj;
                
                if (rhinoObject instanceof rhino.Curve) {
                    threeObj = curveToThree(rhinoObject, material);
                } 
                else if (rhinoObject.toThreejsJSON) {
                    const loader = new THREE.BufferGeometryLoader();
                    const geo = loader.parse(rhinoObject.toThreejsJSON());
                    threeObj = new THREE.Line(geo, material);
                }

                if (threeObj) {
                    threeObj.name = "generated_geo";
                    threeObj.rotation.x = -Math.PI / 2;
                    scene.add(threeObj);
                }
            });
        });
    };

    processGeometry(1, 0x000000); 
    processGeometry(2, 0xff0000); 

    if (data.values.length > 3 && data.values[3].InnerTree) {
        const logBranch = Object.values(data.values[3].InnerTree)[0];
        if (logBranch && logBranch.length > 0) {
            const logLines = logBranch.map(item => {
                try { return JSON.parse(item.data); } catch (e) { return item.data; }
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
                inputs[param.name] = e.target.result.split(',')[1];
                triggerSolve();
            };
            reader.readAsDataURL(file);
        });
        uploadWrapper.appendChild(btn);
        uploadWrapper.appendChild(fileInput);
        wrapper.appendChild(uploadWrapper);
    } else if (param.paramType === 'Integer' || param.paramType === 'Number') {
        const label = document.createElement('label');
        label.innerText = param.name; 
        wrapper.appendChild(label);
        const hasMinMax = (param.minimum !== null && param.maximum !== null);
        const isInt = (param.paramType === 'Integer');
        const input = document.createElement('input');
        if (hasMinMax) {
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
    
    // --- Orthographic Camera Setup ---
    const width = window.innerWidth - 300;
    const height = window.innerHeight;
    const aspect = width / height;
    const viewSize = 110; // Sets the "zoom" or visible units

    camera = new THREE.OrthographicCamera(
        -viewSize * aspect / 2, 
         viewSize * aspect / 2, 
         viewSize / 2, 
        -viewSize / 2, 
        0.1, 
        2000
    );

    // Initial position for parallel projection
    camera.position.set(60, 100, 60); 

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height); 
    
    const canvasContainer = document.getElementById('canvas-container');
    canvasContainer.innerHTML = ''; 
    canvasContainer.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    
    const gridColor = 0x888888;
    const points = [];
    for (let x = -6; x <= 54; x += 1) { points.push(new THREE.Vector3(x, 0, 6), new THREE.Vector3(x, 0, -102)); }
    for (let z = 6; z >= -102; z -= 1) { points.push(new THREE.Vector3(-6, 0, z), new THREE.Vector3(54, 0, z)); }

    const gridGeo = new THREE.BufferGeometry().setFromPoints(points);
    const gridMat = new THREE.LineBasicMaterial({ color: gridColor, opacity: 0.4, transparent: true });
    scene.add(new THREE.LineSegments(gridGeo, gridMat));

    const rectPoints = [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(48, 0, 0),
        new THREE.Vector3(48, 0, -96),
        new THREE.Vector3(0, 0, -96),
        new THREE.Vector3(0, 0, 0)
    ];
    const borderGeo = new THREE.BufferGeometry().setFromPoints(rectPoints);
    const border = new THREE.Line(borderGeo, new THREE.LineBasicMaterial({ color: 0x2196F3 }));
    border.position.y = 0.05;
    scene.add(border);

    const origin = new THREE.Vector3(0, 0, 0);
    scene.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), origin, 12, 0xff0000));
    scene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), origin, 12, 0x00ff00));
    scene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), origin, 12, 0x0000ff));

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(50, 50, 0);
    scene.add(dirLight);

    window.addEventListener('resize', onWindowResize, false);
    animate();
}

function onWindowResize() {
    const width = window.innerWidth - 300; 
    const height = window.innerHeight;
    const aspect = width / height;
    const viewSize = 110;

    // Update Orthographic Frustum
    camera.left = -viewSize * aspect / 2;
    camera.right = viewSize * aspect / 2;
    camera.top = viewSize / 2;
    camera.bottom = -viewSize / 2;
    
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

function handleViewSnap(view) {
    const dist = 500; // Far distance for orthographic alignment
    const center = new THREE.Vector3(24, 0, -48); 
    
    switch(view) {
        case 'top': 
            camera.position.set(24, dist, -48); 
            break;
        case 'front': 
            camera.position.set(24, 0, dist); 
            break;
        case 'right': 
            camera.position.set(dist, 0, -48); 
            break;
        case 'iso': 
        default: 
            camera.position.set(100, 100, 100); 
            break;
    }
    
    controls.target.copy(center);
    controls.update();
}