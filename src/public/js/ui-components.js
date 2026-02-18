/**
 * Shared UI Components for Compute AppServer
 * Includes: Compute Controls, View Controls, and Theme Management
 */

// --- THEMES ---
// All DaisyUI Themes
export const DAISY_THEMES = [
    "light", "dark", "cupcake", "bumblebee", "emerald", "corporate", "synthwave", "retro", "cyberpunk",
    "valentine", "halloween", "garden", "forest", "aqua", "lofi", "pastel", "fantasy", "wireframe",
    "black", "luxury", "dracula", "cmyk", "autumn", "business", "acid", "lemonade", "night", "coffee",
    "winter", "dim", "nord", "sunset"
];

// Color Palettes for 3D Geometry based on theme
// Returns an array of hex colors to cycle through
export function getThemePalette(themeName) {
    // Define specific overrides, or default to a safe set
    const palettes = {
        light: [0x00a96e, 0xffbe00, 0xff5861, 0x0055ff, 0xa991f7], // Primary colors
        dark: [0x1db954, 0xff0055, 0x00d4ff, 0xffbd00, 0xbd93f9], // Neon
        cyberpunk: [0xff003c, 0xfcee0a, 0x00f0ff, 0xff00ff, 0x05ffa1], // Cyber
        corporate: [0x4b6bfb, 0x7b92b2, 0x67cba0, 0x181a2a, 0xffffff],
        // Default Fallback
        default: [0x333333, 0x666666, 0x999999, 0xcccccc, 0x000000]
    };

    // For now, return a generated palette based on the theme name hash or just specific ones
    // Integrating all 30+ themes manually is tedious, so we'll use a robust fallback 
    // or map them to 'light' vs 'dark' groups for geometry visibility.

    if (palettes[themeName]) return palettes[themeName];

    // Heuristic: Is it likely dark?
    const darkThemes = ["dark", "synthwave", "halloween", "forest", "black", "luxury", "dracula", "business", "night", "coffee", "dim", "sunset"];
    if (darkThemes.includes(themeName)) return palettes.dark;

    return palettes.light;
}

// --- COMPUTE CONTROLS ---
export function renderComputeControls(container, onCompute, onToggleLive) {
    container.innerHTML = '';

    // Wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'compute-controls';
    wrapper.style.display = 'flex';
    wrapper.style.gap = '10px';
    wrapper.style.marginBottom = '20px';
    wrapper.style.alignItems = 'center';

    // Compute Button
    const btn = document.createElement('button');
    btn.innerText = 'Compute';
    btn.className = 'btn btn-primary btn-sm'; // DaisyUI / Bootstrap style classes
    btn.onclick = onCompute;

    // Live Toggle
    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'label cursor-pointer';
    toggleLabel.style.display = 'flex';
    toggleLabel.style.alignItems = 'center';
    toggleLabel.style.gap = '5px';

    const span = document.createElement('span');
    span.className = 'label-text';
    span.innerText = 'Live';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'toggle toggle-primary toggle-sm';
    checkbox.addEventListener('change', (e) => onToggleLive(e.target.checked));

    toggleLabel.appendChild(span);
    toggleLabel.appendChild(checkbox);

    wrapper.appendChild(btn);
    wrapper.appendChild(toggleLabel);

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
    wrapper.style.background = 'rgba(255,255,255,0.8)'; // Semi-transparent
    wrapper.style.padding = '5px';
    wrapper.style.borderRadius = '5px';
    wrapper.style.display = 'flex';
    wrapper.style.gap = '5px';
    wrapper.style.zIndex = '1000';

    views.forEach(v => {
        const btn = document.createElement('button');
        btn.innerText = v.name;
        btn.style.padding = '2px 8px';
        btn.style.cursor = 'pointer';
        btn.style.border = '1px solid #ccc';
        btn.style.background = '#fff';
        btn.style.borderRadius = '3px';
        btn.style.fontSize = '0.8em';

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
export function renderThemeSelector(container, onThemeChange) {
    const select = document.createElement('select');
    select.className = 'select select-bordered select-xs w-full max-w-xs';
    select.style.marginBottom = '10px';

    DAISY_THEMES.forEach(theme => {
        const option = document.createElement('option');
        option.value = theme;
        option.innerText = theme.charAt(0).toUpperCase() + theme.slice(1);
        select.appendChild(option);
    });

    select.value = 'light';
    select.addEventListener('change', (e) => onThemeChange(e.target.value));

    container.appendChild(select);
}
