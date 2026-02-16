import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import rhino3dm from 'rhino3dm'
import { renderComputeControls, renderViewControls } from 'ui_components'

// --- CONFIGURATION ---
const DEFAULT_DEFINITION_NAME = 'cncProfiler-v0.9.1.gh';

// --- GLOBALS ---
let currentDefinition = null;
let inputs = {};
let gcodeResult = null;
let scene, camera, renderer, controls;
let rhino;

// State
let liveCompute = false;
let defaultDxfB64 = null;
let lastSolveDuration = 0; // Performance Metric

// Modal State
let activeParamName = null;
let activeDisplayEl = null;
let activeSliderEl = null;

// --- SETUP ---
const container = document.getElementById('controls-container');
const downloadBtn = document.getElementById('downloadBtn');
const definitionSelect = document.getElementById('definitionSelect');
const computeBtn = document.getElementById('computeBtn');
const liveComputeToggle = document.getElementById('liveComputeToggle');
const warningContainer = document.getElementById('warning-container');

// Modal Elements
const valueModal = document.getElementById('value-modal');
const modalTitle = document.getElementById('modalTitle');
const modalInput = document.getElementById('modalInput');
const modalSaveBtn = document.getElementById('modalSaveBtn');
const modalCancelBtn = document.getElementById('modalCancelBtn');

init();

async function init() {

    // --- Info Panel Logic (Right Side) ---
    const infoPanel = document.getElementById('info-panel');
    const infoToggle = document.getElementById('info-toggle');
    const closeInfo = document.getElementById('close-info');

    if (infoToggle && infoPanel) {
        infoToggle.onclick = () => { infoPanel.style.right = '0'; };
        closeInfo.onclick = () => { infoPanel.style.right = '-350px'; };
    }
    // ------------------------

    const overlay = document.getElementById('startup-overlay');
    const statusText = document.getElementById('startup-status');

    try {
        // 0. Fetch Template DXF (default)
        try {
            const dxfRes = await fetch('files/Template.dxf');
            if (dxfRes.ok) {
                const blob = await dxfRes.blob();
                defaultDxfB64 = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result.split(',')[1]);
                    reader.readAsDataURL(blob);
                });
                console.log("Template.dxf loaded internally.");
            } else {
                console.log("Template.dxf not found.");
            }
        } catch (e) {
            console.log("Error loading Template.dxf", e);
        }

        // 1. Send Wake Up Command
        statusText.innerText = "Waking up Compute Server...";
        console.log("Sending wakeup command...");
        fetch('/wakeup', { method: 'POST' }).catch(e => console.error("Wakeup trigger failed:", e));

        // 2. Poll Status via /wakeStatus
        let isReady = false;
        while (!isReady) {
            try {
                const res = await fetch('/wakeStatus');
                const data = await res.json();

                // step: 1=Azure, 2=Health, 3=Version
                // status: 'offline', 'starting', 'live'

                if (data.status === 'live') {
                    isReady = true;
                    statusText.innerText = "Compute Server is Ready!";
                    console.log("WakeStatus: Live");
                } else {
                    statusText.innerText = `Starting... (${data.message})`;
                    console.log("WakeStatus:", data.status, data.message);
                }

            } catch (err) {
                console.log("Status check failed, retrying...", err);
                statusText.innerText = "Connecting...";
            }

            if (!isReady) {
                // Wait 2 seconds before retrying
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    } catch (err) {
        statusText.innerText = "Error: " + err.message;
        return; // Stop execution
    }

    // 3. Server is ready, hide overlay
    overlay.style.display = 'none';

    // Load Rhino3dm
    rhino = await rhino3dm();
    console.log('Rhino3dm loaded.');

    init3D();

    try {
        const res = await fetch('/api/definitions');
        const definitions = await res.json();

        let defaultExists = false;

        definitions.forEach(def => {
            // FILTER: Only show CNC category files
            if (def.category === 'cnc') {
                const option = document.createElement('option');
                option.value = def.name;
                option.innerText = def.name;
                definitionSelect.appendChild(option);

                if (def.name === DEFAULT_DEFINITION_NAME) {
                    defaultExists = true;
                }
            }
        });

        // --- LOAD DEFAULT IF AVAILABLE ---
        if (defaultExists) {
            definitionSelect.value = DEFAULT_DEFINITION_NAME;
            loadDefinition(DEFAULT_DEFINITION_NAME);
        }

    } catch (err) {
        console.error("Failed to load definitions list", err);
    }

    definitionSelect.addEventListener('change', (e) => {
        if (e.target.value) {
            loadDefinition(e.target.value);
        }
    });

    window.addEventListener('snap-view', (e) => {
        handleViewSnap(e.detail);
    });

    // --- SHARED UI: Compute Controls ---
    renderComputeControls(document.getElementById('compute-container'), triggerSolve, (isLive) => {
        liveCompute = isLive;
        if (liveCompute) triggerSolve();
    });

    // --- Modal Events ---
    modalCancelBtn.addEventListener('click', () => {
        valueModal.style.display = 'none';
    });

    modalSaveBtn.addEventListener('click', () => {
        const newVal = Number(modalInput.value);
        if (activeParamName) {
            inputs[activeParamName] = newVal;

            // Update Text Display
            if (activeDisplayEl) {
                activeDisplayEl.innerText = newVal;
            }

            // Update Slider if exists
            if (activeSliderEl) {
                activeSliderEl.value = newVal;
            }

            // Trigger Solve if Live or Manual (acting as update)
            if (liveCompute) {
                triggerSolve();
            }
        }
        valueModal.style.display = 'none';
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
    warningContainer.innerHTML = ''; // Clear warnings

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

        // 1. Create controls and populate initial 'inputs' object
        sortedInputs.forEach(param => createControl(param));

        // 2. Pre-load default DXF if this definition requires a DXF and we have a default
        if (inputs.hasOwnProperty('b64DXF') && !inputs['b64DXF'] && defaultDxfB64) {
            inputs['b64DXF'] = defaultDxfB64;
            console.log("Used Template.dxf for initial inputs");
        }

        // 3. Automatically trigger first solve
        setTimeout(() => {
            triggerSolve();
        }, 100);

    } catch (err) {
        container.innerHTML = `<p style="color:red">Error: ${err.message}</p>`;
        console.error(err);
    }
}

async function triggerSolve() {
    if (!currentDefinition) return;

    if (inputs.hasOwnProperty('b64DXF') && !inputs['b64DXF']) {
        console.log("Waiting for DXF upload before solving...");
        return;
    }

    document.getElementById('loader').style.display = 'block';
    downloadBtn.disabled = true;
    downloadBtn.innerText = "Calculating...";
    warningContainer.innerHTML = ''; // Clear old warnings

    // --- Performance Timing Start ---
    const startTime = performance.now();

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

        // --- Performance Timing End ---
        lastSolveDuration = (performance.now() - startTime).toFixed(0);

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

// Convert Rhino Curve to Three.js Line
function curveToThree(rhinoCurve, material) {
    const points = [];

    // --- STRATEGY 1: Exact Control Points (Best for PolylineCurves / Cut Paths) ---
    if (rhinoCurve instanceof rhino.PolylineCurve) {
        // Extract vertices directly to avoid sampling errors
        const count = rhinoCurve.pointCount;
        for (let i = 0; i < count; i++) {
            const pt = rhinoCurve.point(i);
            points.push(new THREE.Vector3(pt[0], pt[1], pt[2]));
        }
    }
    else if (rhinoCurve instanceof rhino.NurbsCurve && rhinoCurve.order === 2) {
        // Order 2 NURBS are also basically polylines (linear degree 1)
        const domain = rhinoCurve.domain;
        const count = 3000;
        for (let i = 0; i <= count; i++) {
            const t = domain[0] + (i / count) * (domain[1] - domain[0]);
            const pt = rhinoCurve.pointAt(t);
            points.push(new THREE.Vector3(pt[0], pt[1], pt[2]));
        }
    }
    else {
        // --- STRATEGY 2: High Res Sampling (Fallback for curved geometry) ---
        const domain = rhinoCurve.domain;
        const count = 3000;
        for (let i = 0; i <= count; i++) {
            const t = domain[0] + (i / count) * (domain[1] - domain[0]);
            const pt = rhinoCurve.pointAt(t);
            points.push(new THREE.Vector3(pt[0], pt[1], pt[2]));
        }
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);
    return line;
}

// Helper to process geometry branches
function addGeometryToScene(tree, colorHex) {
    if (!tree) return;
    const material = new THREE.LineBasicMaterial({ color: colorHex });

    Object.values(tree).forEach(branch => {
        // Check for "List of Points" scenario (User Request)
        if (branch.length > 1 && isPointData(branch[0])) {
            // Treat this whole branch as ONE connected polyline
            const points = [];
            branch.forEach(item => {
                const ptObj = decodeItem(item);
                if (ptObj) {
                    // Rhino.Point returns location as .location or [0],[1],[2]?
                    if (ptObj.location) {
                        points.push(new THREE.Vector3(ptObj.location[0], ptObj.location[1], ptObj.location[2]));
                    } else if (Array.isArray(ptObj)) {
                        points.push(new THREE.Vector3(ptObj[0], ptObj[1], ptObj[2]));
                    } else {
                        // Fallback for Point3d struct
                        points.push(new THREE.Vector3(ptObj.x, ptObj.y, ptObj.z));
                    }
                }
            });
            if (points.length > 1) {
                const geo = new THREE.BufferGeometry().setFromPoints(points);
                const line = new THREE.Line(geo, material);
                line.name = "generated_geo";
                line.rotation.x = -Math.PI / 2;
                scene.add(line);
            }
            return; // Done with this branch
        }

        // Standard behavior (List of Curves, Meshes, etc.)
        branch.forEach(item => {
            const rhinoObject = decodeItem(item);
            if (!rhinoObject) return;

            let threeObj = null;

            // 1. Try Native Conversion (Preserves Vertices/Polyline structure if meshes)
            if (rhinoObject.toThreejsJSON) {
                try {
                    const loader = new THREE.BufferGeometryLoader();
                    const json = rhinoObject.toThreejsJSON();
                    const geo = loader.parse(json);

                    if (rhinoObject instanceof rhino.Curve) {
                        threeObj = new THREE.Line(geo, material);
                    } else if (rhinoObject instanceof rhino.Mesh) {
                        threeObj = new THREE.Mesh(geo, material);
                    } else {
                        threeObj = new THREE.Line(geo, material);
                    }
                } catch (e) {
                    // console.warn("Native toThreejsJSON failed...", e);
                }
            }

            // 2. Fallback / Override for Curve: Use Custom CurveToThree for better precision
            if (rhinoObject instanceof rhino.Curve) {
                // Regenerate using our high-precision method
                threeObj = curveToThree(rhinoObject, material);
            }

            // 3. Add to Scene
            if (threeObj) {
                threeObj.name = "generated_geo";
                threeObj.rotation.x = -Math.PI / 2;
                scene.add(threeObj);
            }
        });
    });
}

function isPointData(item) {
    if (!item || !item.data) return false;
    return (item.type && item.type.includes("Point"));
}

// New helper to extract strings/logs from data tree
function extractStrings(tree) {
    const results = [];
    if (!tree) return results;

    Object.values(tree).forEach(branch => {
        branch.forEach(item => {
            try {
                // Try parsing JSON if it's stringified
                const parsed = JSON.parse(item.data);
                results.push(parsed);
            } catch (e) {
                // Otherwise use raw string
                results.push(item.data);
            }
        });
    });
    return results;
}

// Helper to check if a tree actually contains any items (ignores empty branches)
function hasTreeData(tree) {
    if (!tree) return false;
    // Return true if ANY branch has length > 0
    return Object.values(tree).some(branch => branch && branch.length > 0);
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
    logBox.innerText = `✅ Solution completed in ${lastSolveDuration}ms.`;

    if (!data || !data.values || data.values.length < 1) {
        logBox.innerText += "\n(No output values returned)";
        return;
    }

    // --- RESET STATE ---
    gcodeResult = null;
    downloadBtn.disabled = true;
    downloadBtn.innerText = "Download GCode";

    const previewBox = document.getElementById('gcode-preview');
    previewBox.style.display = 'none';
    previewBox.innerText = '';
    warningContainer.innerHTML = ''; // Clear warnings

    // --- CLEAR SCENE ---
    if (scene) {
        const toRemove = [];
        scene.traverse(child => { if (child.name === "generated_geo") toRemove.push(child); });
        toRemove.forEach(c => scene.remove(c));
    }

    // --- PROCESS VALUES BY NAME ---
    // Log, GCode, dxfLines, CutPath, Bad Lines, Unused Lines

    data.values.forEach(item => {
        const name = item.ParamName;
        const tree = item.InnerTree;

        if (!name || !tree) return;

        switch (name) {
            case 'Log':
                const logLines = extractStrings(tree);
                if (logLines.length > 0) {
                    logBox.innerText += "\n" + logLines.join('\n');
                }
                break;

            case 'GCode':
                const gcodeLines = extractStrings(tree);
                if (gcodeLines.length > 0) {
                    const joinedGcode = gcodeLines.join('\n');

                    // --- NEW CHECK: CATCH EMPTY GEOMETRY ERROR ---
                    if (joinedGcode.trim() === "Error: Input text is empty.") {
                        const warn = document.createElement('div');
                        warn.className = 'warning-msg';
                        warn.innerText = "⚠️ Could not find geometry to process. Check geometry layer assignment";
                        warningContainer.appendChild(warn);

                        // Disable download
                        gcodeResult = null;
                        downloadBtn.disabled = true;
                        downloadBtn.innerText = "Download GCode";
                        previewBox.style.display = 'none';
                    } else {
                        gcodeResult = joinedGcode;
                        downloadBtn.disabled = false;
                        downloadBtn.innerText = "Download GCode";
                        previewBox.style.display = 'block';
                        previewBox.innerText = gcodeResult;
                    }
                }
                break;

            case 'dxfLines':
                // Black
                addGeometryToScene(tree, 0x000000);
                break;

            case 'CutPath':
            case 'Cut Path':
                // Cyan
                addGeometryToScene(tree, 0x00FFFF);
                break;

            case 'Bad Lines':
                // Red
                addGeometryToScene(tree, 0xFF0000);

                // --- FIXED WARNING LOGIC ---
                if (hasTreeData(tree)) {
                    const warn = document.createElement('div');
                    warn.className = 'warning-msg';
                    warn.innerText = "⚠️ Open curves detected (cannot be used). Check Red lines.";
                    warningContainer.appendChild(warn);
                }
                break;

            case 'Unused Lines':
                // Magenta
                addGeometryToScene(tree, 0xFF00FF);

                // --- FIXED WARNING LOGIC ---
                if (hasTreeData(tree)) {
                    const warn = document.createElement('div');
                    warn.className = 'warning-msg';
                    warn.innerText = "⚠️ Curves detected on unused layers. Check Magenta lines.";
                    warningContainer.appendChild(warn);
                }
                break;

            default:
                // Optional: Handle other named outputs if needed
                break;
        }
    });
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

        // --- DXF Requirements Help ---
        const helpLink = document.createElement('div');
        helpLink.style.cssText = "text-align: right; font-size: 0.8em; color: #666; cursor: pointer; margin-bottom: 5px;";
        helpLink.innerHTML = "ℹ️ <u>DXF Requirements</u>";
        helpLink.onclick = () => alert(
            "DXF REQUIREMENTS:\n" +
            "1. Units: Files must be in Inches.\n" +
            "2. Layers: \n   - 'Outside': Exterior profile cuts.\n   - 'Inside': Interior holes/features.\n" +
            "3. Geometry: All curves must be closed loops.\n" +
            "4. Cleanup: Remove duplicate lines and text blocks."
        );
        wrapper.appendChild(helpLink);
        // ----------------------------------

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
                // Always trigger solve on new upload
                triggerSolve();
            };
            reader.readAsDataURL(file);
        });

        inputs[param.name] = null;

        uploadWrapper.appendChild(btn);
        uploadWrapper.appendChild(fileInput);
        wrapper.appendChild(uploadWrapper);

    } else if (param.paramType === 'Integer' || param.paramType === 'Number') {
        const label = document.createElement('label');
        label.innerText = param.name;

        // --- Dynamic Tooltip ---
        if (param.description) {
            const icon = document.createElement('span');
            icon.className = 'help-icon';
            icon.innerText = '?';
            icon.setAttribute('data-tooltip', param.description);
            label.appendChild(icon);
        }
        // ----------------------------

        wrapper.appendChild(label);

        const isInt = (param.paramType === 'Integer');

        // --- Robust Default Value Logic ---
        let rawDef = param.default;

        if (rawDef === undefined || rawDef === null || rawDef === '') {
            rawDef = 0.01;
        }

        let defaultValue = Number(rawDef);

        if (Number.isNaN(defaultValue)) {
            defaultValue = 0.01;
        }

        if (isInt) {
            defaultValue = Math.round(defaultValue);
        }

        inputs[param.name] = defaultValue;

        const valDisplay = document.createElement('div');
        valDisplay.className = 'val-display-static';
        valDisplay.innerText = defaultValue;
        label.appendChild(valDisplay);

        const hasMinMax = (param.minimum !== null && param.maximum !== null);
        let slider = null;

        if (hasMinMax) {
            slider = document.createElement('input');
            slider.type = 'range';
            slider.min = param.minimum;
            slider.max = param.maximum;
            slider.step = isInt ? 1 : 0.001;
            slider.value = defaultValue;

            slider.addEventListener('input', (e) => {
                const val = Number(e.target.value);
                valDisplay.innerText = val;
                inputs[param.name] = val;
            });
            slider.addEventListener('mouseup', () => {
                if (liveCompute) triggerSolve();
            });
            wrapper.appendChild(slider);
        }

        valDisplay.addEventListener('click', () => {
            activeParamName = param.name;
            activeDisplayEl = valDisplay;
            activeSliderEl = slider;

            modalTitle.innerText = `Set ${param.name}`;
            modalInput.value = inputs[param.name];
            modalInput.step = isInt ? 1 : 'any';

            valueModal.style.display = 'flex';
            modalInput.focus();
        });

    } else if (param.paramType === 'Boolean') {
        const label = document.createElement('label');
        label.innerText = param.name;

        if (param.description) {
            const icon = document.createElement('span');
            icon.className = 'help-icon';
            icon.innerText = '?';
            icon.setAttribute('data-tooltip', param.description);
            label.appendChild(icon);
        }

        wrapper.appendChild(label);
        const toggle = document.createElement('div');
        toggle.className = 'toggle';

        const defaultState = param.default === true;
        inputs[param.name] = defaultState;

        // --- UPDATED: Hops Custom Labels with Z0 Override ---
        let trueLabel = param.maximum || "ON";
        let falseLabel = param.minimum || "OFF";

        // CHANGED: Swapped Top/Bottom
        if (param.name.includes("Z0")) {
            trueLabel = "Bottom";
            falseLabel = "Top";
        }

        toggle.innerText = defaultState ? trueLabel : falseLabel;
        if (defaultState) toggle.classList.add('active');

        toggle.onclick = () => {
            inputs[param.name] = !inputs[param.name];
            toggle.classList.toggle('active');
            toggle.innerText = inputs[param.name] ? trueLabel : falseLabel;
            if (liveCompute) triggerSolve();
        };
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

    const width = window.innerWidth - 300;
    const height = window.innerHeight;
    const aspect = width / height;
    const viewSize = 110;

    camera = new THREE.OrthographicCamera(
        -viewSize * aspect / 2,
        viewSize * aspect / 2,
        viewSize / 2,
        -viewSize / 2,
        0.1,
        2000
    );

    camera.position.set(60, 100, 60);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);

    const canvasContainer = document.getElementById('canvas-container');
    canvasContainer.innerHTML = '';
    canvasContainer.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // --- SHARED UI: View Controls ---
    renderViewControls(document.getElementById('view-controls-container'), camera, controls, THREE);

    controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE
    };

    const gridColor = 0x888888;
    const points = [];
    for (let x = -6; x <= 54; x += 1) { points.push(new THREE.Vector3(x, 0, 6), new THREE.Vector3(x, 0, -102)); }
    for (let z = 6; z >= -102; z -= 1) { points.push(new THREE.Vector3(-6, 0, z), new THREE.Vector3(54, 0, z)); }

    const gridGeo = new THREE.BufferGeometry().setFromPoints(points);
    const gridMat = new THREE.LineBasicMaterial({ color: gridColor, opacity: 0.4, transparent: true });
    scene.add(new THREE.LineSegments(gridGeo, gridMat));

    // Thicker Work Area Border
    const rectPoints = [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(48, 0, 0),
        new THREE.Vector3(48, 0, -96),
        new THREE.Vector3(0, 0, -96),
        new THREE.Vector3(0, 0, 0)
    ];
    const borderGeo = new THREE.BufferGeometry().setFromPoints(rectPoints);
    const border = new THREE.Line(borderGeo, new THREE.LineBasicMaterial({ color: 0x2196F3, linewidth: 5 }));
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
    const dist = 500;
    const center = new THREE.Vector3(24, 0, -48);

    switch (view) {
        case 'top':
            camera.position.set(24, dist, -48);
            break;
        case 'front':
            camera.position.set(24, 0, dist);
            break;
        case 'right':
            camera.position.set(dist, 0, -48);
            break;
        case 'left':
            camera.position.set(-dist, 0, -48);
            break;
        case 'back':
            camera.position.set(24, 0, -dist);
            break;
        case 'bottom':
            camera.position.set(24, -dist, -48);
            break;
        case 'iso':
        default:
            camera.position.set(100, 100, 100);
            break;
    }

    controls.target.copy(center);
    controls.update();
}