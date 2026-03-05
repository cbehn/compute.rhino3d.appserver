/**
 * Shared UI Components for Compute AppServer
 * Includes: Compute Controls, View Controls, and Theme Management
 */

// --- THEMES ---
export let DAISY_THEMES = ["light", "dark"]; // Initially fallback
export let THEME_DATA = null;

export async function initThemes() {
    try {
        const res = await fetch('/public/daisy-themes.json');
        if (res.ok) {
            const data = await res.json();
            if (data.daisyUI && data.daisyUI.themes) {
                THEME_DATA = data.daisyUI.themes;
                DAISY_THEMES = Object.keys(THEME_DATA);
            }
        }
    } catch (e) {
        console.warn("Failed to load daisy-themes.json", e);
    }
}

export function applyThemeToPage(themeName) {
    if (!THEME_DATA || !THEME_DATA[themeName]) return;
    const t = THEME_DATA[themeName];
    document.documentElement.style.setProperty('--primary', t.primary);
    document.documentElement.style.setProperty('--secondary', t.secondary);
    document.documentElement.style.setProperty('--accent', t.accent);
    document.documentElement.style.setProperty('--neutral', t.neutral);
    document.documentElement.style.setProperty('--base-100', t['base-100']);
    document.documentElement.style.setProperty('--info', t.info);
    document.documentElement.style.setProperty('--success', t.success);
    document.documentElement.style.setProperty('--warning', t.warning);
    document.documentElement.style.setProperty('--error', t.error);

    // Auto-calculate text color based on base-100 brightness (approx)
    const hex = t['base-100'].replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    const isDark = yiq < 128;

    document.documentElement.style.setProperty('--base-content', isDark ? '#ffffff' : '#1f2937');
    document.documentElement.style.setProperty('--panel-bg', isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)');
    document.documentElement.style.setProperty('--border-color', isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)');
}

// Color Palettes for 3D Geometry based on theme
// Returns an array of hex colors to cycle through
export function getThemePalette(themeName) {
    if (THEME_DATA && THEME_DATA[themeName]) {
        const t = THEME_DATA[themeName];
        const hexToNum = (hexStr) => parseInt(hexStr.replace(/^#/, ''), 16);
        return [
            hexToNum(t.primary),
            hexToNum(t.secondary),
            hexToNum(t.accent),
            hexToNum(t.info),
            hexToNum(t.success),
            hexToNum(t.warning),
            hexToNum(t.error)
        ];
    }

    // Default Fallback
    const palettes = {
        light: [0x00a96e, 0xffbe00, 0xff5861, 0x0055ff, 0xa991f7],
        dark: [0x1db954, 0xff0055, 0x00d4ff, 0xffbd00, 0xbd93f9]
    };
    return palettes.light;
}

// --- COMPUTE CONTROLS ---
export function renderComputeControls(container, onCompute, onToggleLive) {
    container.innerHTML = '';

    // Inject CSS for the toggle switch if not already present
    if (!document.getElementById('compute-controls-css')) {
        const style = document.createElement('style');
        style.id = 'compute-controls-css';
        style.innerHTML = `
            .compute-controls-wrapper {
                background: var(--base-100, #f5f5f5);
                border: 1px solid var(--border-color, #e0e0e0);
                border-radius: 8px;
                padding: 10px 15px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                box-shadow: 0 1px 3px rgba(0,0,0,0.05);
                margin-bottom: 20px;
                transition: background-color 0.3s, border-color 0.3s;
            }
            .live-toggle-container {
                display: flex;
                align-items: center;
                gap: 10px;
                font-weight: 600;
                color: var(--base-content, #555);
                font-size: 0.9em;
                transition: color 0.3s;
            }
            /* IOS Style Toggle */
            .ios-toggle {
                position: relative;
                width: 44px;
                height: 24px;
                -webkit-appearance: none;
                background: #e0e0e0;
                outline: none;
                border-radius: 20px;
                box-shadow: inset 0 0 5px rgba(0,0,0,0.1);
                transition: background 0.3s;
                cursor: pointer;
            }
            .ios-toggle::after {
                content: '';
                position: absolute;
                top: 2px;
                left: 2px;
                width: 20px;
                height: 20px;
                background: white;
                border-radius: 50%;
                box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                transition: transform 0.3s;
            }
            .ios-toggle:checked {
                background: #4cd964;
            }
            .ios-toggle:checked::after {
                transform: translateX(20px);
            }
            
            .btn-compute-primary {
                background-color: var(--primary, #2196F3);
                color: var(--base-100, white);
                border: none;
                padding: 8px 20px;
                border-radius: 6px;
                font-weight: 600;
                font-size: 0.95em;
                cursor: pointer;
                transition: background-color 0.2s, transform 0.1s;
                box-shadow: 0 2px 5px var(--primary, rgba(33, 150, 243, 0.3));
            }
            .btn-compute-primary:hover {
                background-color: var(--primary-focus, #1976D2);
                filter: brightness(0.9);
            }
            .btn-compute-primary:active {
                transform: translateY(1px);
            }
            .btn-compute-primary:disabled {
                background-color: #ccc;
                cursor: not-allowed;
                box-shadow: none;
            }
        `;
        document.head.appendChild(style);
    }

    // Wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'compute-controls-wrapper';

    // Live Toggle (Left)
    const toggleContainer = document.createElement('div');
    toggleContainer.className = 'live-toggle-container';

    const toggleInput = document.createElement('input');
    toggleInput.type = 'checkbox';
    toggleInput.className = 'ios-toggle';
    toggleInput.id = 'live-compute-toggle';
    toggleInput.addEventListener('change', (e) => onToggleLive(e.target.checked));

    const toggleLabel = document.createElement('label');
    toggleLabel.htmlFor = 'live-compute-toggle';
    toggleLabel.innerText = 'Live';
    toggleLabel.style.cursor = 'pointer';

    toggleContainer.appendChild(toggleInput);
    toggleContainer.appendChild(toggleLabel);

    // Compute Button (Right)
    const btn = document.createElement('button');
    btn.innerText = 'Compute';
    btn.className = 'btn-compute-primary';
    btn.onclick = onCompute;

    wrapper.appendChild(toggleContainer);
    wrapper.appendChild(btn);

    container.appendChild(wrapper);

    return {
        setComputing: (isComputing) => {
            btn.disabled = isComputing;
            btn.innerText = isComputing ? 'Solving...' : 'Compute';
        }
    };
}

// --- VIEW CONTROLS ---
export function renderViewControls(container, camera, controls, THREE) {
    container.innerHTML = '';

    const views = [
        { name: 'Iso', pos: [50, 50, 50] },
        { name: 'Top', pos: [0, 100, 0] },
        { name: 'Front', pos: [0, 0, 100] },
        { name: 'Right', pos: [100, 0, 0] }
    ];

    const wrapper = document.createElement('div');
    wrapper.className = 'view-controls';
    wrapper.style.position = 'absolute';
    wrapper.style.top = '10px';
    wrapper.style.right = '10px';
    wrapper.style.background = 'var(--base-100, #fff)';
    wrapper.style.padding = '5px';
    wrapper.style.borderRadius = '5px';
    wrapper.style.display = 'flex';
    wrapper.style.gap = '5px';
    wrapper.style.zIndex = '1000';
    wrapper.style.transition = 'background-color 0.3s';

    views.forEach(v => {
        const btn = document.createElement('button');
        btn.innerText = v.name;
        btn.style.padding = '2px 8px';
        btn.style.cursor = 'pointer';
        btn.style.border = '1px solid var(--border-color, #ccc)';
        btn.style.background = 'var(--base-100, #fff)';
        btn.style.color = 'var(--base-content, #333)';
        btn.style.borderRadius = '3px';
        btn.style.fontSize = '0.8em';
        btn.style.transition = 'background-color 0.3s, color 0.3s, border-color 0.3s';

        btn.onclick = () => {
            // Smooth transition could be added here
            if (camera instanceof THREE.OrthographicCamera) {
                // Adjust for ortho zoom preservation if needed
                const dist = 100; // arbitrary base
                camera.position.set(v.pos[0] ? dist : 0, v.pos[1] ? dist : 0, v.pos[2] ? dist : 0);
                if (v.name === 'Iso') camera.position.set(dist, dist, dist);
            } else {
                camera.position.set(...v.pos);
            }
            camera.lookAt(0, 0, 0);
            controls.target.set(0, 0, 0);
            controls.update();
        };

        wrapper.appendChild(btn);
    });

    container.appendChild(wrapper);
}

// --- THEME SELECTOR ---
export function renderThemeSelector(container, onThemeChange, defaultTheme = 'light') {
    const select = document.createElement('select');
    select.className = 'select select-bordered select-xs w-full max-w-xs';
    select.style.marginBottom = '10px';

    DAISY_THEMES.forEach(theme => {
        const option = document.createElement('option');
        option.value = theme;
        option.innerText = theme.charAt(0).toUpperCase() + theme.slice(1);
        select.appendChild(option);
    });

    select.value = defaultTheme;
    select.addEventListener('change', (e) => {
        applyThemeToPage(e.target.value);
        onThemeChange(e.target.value);
    });

    // Apply default theme initially
    applyThemeToPage(defaultTheme);

    container.appendChild(select);
}

// --- STARTUP OVERLAY (TV TEST PATTERN) ---
export async function showStartupOverlayAndWait() {
    // 1. Inject CSS if not present
    if (!document.getElementById('startup-overlay-css')) {
        const style = document.createElement('style');
        style.id = 'startup-overlay-css';
        style.innerHTML = `
            #startup-overlay-component {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: 9999;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                background-color: #111;
                font-family: 'Courier New', Courier, monospace;
                text-transform: uppercase;
                transition: opacity 0.5s ease;
            }
            .smpte-bars {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                display: flex;
                z-index: -1;
            }
            .smpte-bars .bar { height: 100%; flex: 1; }
            .b-white { background: #c0c0c0; }
            .b-yellow { background: #c0c000; }
            .b-cyan { background: #00c0c0; }
            .b-green { background: #00c000; }
            .b-magenta { background: #c000c0; }
            .b-red { background: #c00000; }
            .b-blue { background: #0000c0; }
            .tv-message-box {
                background: rgba(0, 0, 0, 0.85);
                padding: 40px;
                border: 2px solid white;
                text-align: center;
                color: white;
                box-shadow: 10px 10px 0px rgba(0, 0, 0, 0.5);
                width: 600px;
                height: 300px;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
            }
            .tv-title {
                font-size: 2em;
                font-weight: bold;
                margin-bottom: 20px;
                letter-spacing: 2px;
                color: #ffff00;
                text-shadow: 2px 2px #ff0000;
            }
            .tv-subtitle {
                font-size: 1.2em;
                margin-bottom: 30px;
                color: #00ffff;
            }
            .tv-dynamic-text {
                transition: opacity 0.75s ease-in-out;
                color: #ff00ff;
                font-weight: bold;
                min-height: 1.5em;
            }
        `;
        document.head.appendChild(style);
    }

    // 2. Create DOM Elements
    const overlay = document.createElement('div');
    overlay.id = 'startup-overlay-component';

    overlay.innerHTML = `
        <div class="smpte-bars">
            <div class="bar b-white"></div>
            <div class="bar b-yellow"></div>
            <div class="bar b-cyan"></div>
            <div class="bar b-green"></div>
            <div class="bar b-magenta"></div>
            <div class="bar b-red"></div>
            <div class="bar b-blue"></div>
        </div>
        <div class="tv-message-box">
            <div class="tv-title">PLEASE STAND BY</div>
            <div class="tv-subtitle">STARTING COMPUTE SERVER</div>
            <div style="font-size: 0.9em; color: #ccc; margin-bottom: 20px;">ESTIMATED TIME: 1-2 MINUTES</div>
            <div class="tv-dynamic-text" id="startup-status-text">INITIALIZING...</div>
        </div>
    `;

    document.body.appendChild(overlay);
    const statusText = document.getElementById('startup-status-text');

    // 2.5 Load Fun Phrases
    const shuffleArray = (array) => {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    };

    let funPhrases = [];
    try {
        const pRes = await fetch('/public/loading-phrases.json');
        if (pRes.ok) {
            const pData = await pRes.json();
            funPhrases = pData.sims_loading_phrases || [];
            if (funPhrases.length > 0) {
                shuffleArray(funPhrases);
            }
        }
    } catch (e) {
        console.warn("Could not load fun loading phrases", e);
    }

    // 3. Polling and Animation Logic
    let isReady = false;
    let latestRealStatus = "Waking up Compute Server...";
    let phraseIndex = 0;

    // Initial State
    statusText.style.opacity = '1';
    statusText.innerText = latestRealStatus;

    // Background poller to actually check status
    const pollPromise = (async () => {
        try {
            console.log("Sending wakeup command...");
            fetch('/wakeup', { method: 'POST' }).catch(e => console.error("Wakeup trigger failed:", e));

            while (!isReady) {
                try {
                    const res = await fetch('/wakeStatus');
                    const data = await res.json();

                    if (data.status === 'live') {
                        isReady = true;
                        latestRealStatus = "Compute Server is Ready!";
                    } else {
                        latestRealStatus = `Starting... (${data.message})`;
                    }
                } catch (err) {
                    latestRealStatus = "Connecting...";
                }

                if (!isReady) {
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
        } catch (err) {
            latestRealStatus = "Error: " + err.message;
            throw err;
        }
    })();

    // Background animator to handle the fading text
    const animPromise = (async () => {
        let lastSeenRealStatus = latestRealStatus;
        let isShowingReal = true;
        let fakeCount = 0;
        let fakeTarget = 0;

        await new Promise(r => setTimeout(r, 2000)); // Show initial status

        while (!isReady) {
            // Initiate Fade out
            statusText.style.opacity = '0';
            await new Promise(r => setTimeout(r, 750)); // Wait for fade

            if (isReady) break;

            // Logic to determine what to show next
            if (latestRealStatus !== lastSeenRealStatus) {
                // Real status updated behind the scenes! Show it immediately.
                lastSeenRealStatus = latestRealStatus;
                statusText.innerText = latestRealStatus;
                isShowingReal = true;
            } else {
                if (isShowingReal && funPhrases.length > 0) {
                    // Transition to fake phrases
                    isShowingReal = false;
                    fakeCount = 1;
                    fakeTarget = Math.floor(Math.random() * 3) + 3; // 3 to 5 phrases

                    if (phraseIndex >= funPhrases.length) {
                        shuffleArray(funPhrases);
                        phraseIndex = 0;
                    }
                    statusText.innerText = funPhrases[phraseIndex++] + "...";
                } else if (!isShowingReal && funPhrases.length > 0) {
                    if (fakeCount >= fakeTarget) {
                        // We showed enough fake phrases, back to real
                        isShowingReal = true;
                        statusText.innerText = latestRealStatus;
                    } else {
                        // Show another fake phrase
                        fakeCount++;
                        if (phraseIndex >= funPhrases.length) {
                            shuffleArray(funPhrases);
                            phraseIndex = 0;
                        }
                        statusText.innerText = funPhrases[phraseIndex++] + "...";
                    }
                } else {
                    statusText.innerText = latestRealStatus;
                }
            }

            // Initiate Fade in
            statusText.style.opacity = '1';
            await new Promise(r => setTimeout(r, 1500)); // Hold visible
        }

        // Final state
        statusText.style.opacity = '1';
        statusText.innerText = "Compute Server is Ready!";
    })();

    // Wait for both polling to finish
    try {
        await Promise.all([pollPromise, animPromise]);
    } catch (err) {
        console.error("Startup Sequence Failed", err);
        throw err;
    }

    // 4. Fade out and clean up
    await new Promise(r => setTimeout(r, 500)); // Brief pause on success message
    overlay.style.opacity = '0';
    await new Promise(r => setTimeout(r, 500)); // Wait for fade transition
    if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
    }
}

