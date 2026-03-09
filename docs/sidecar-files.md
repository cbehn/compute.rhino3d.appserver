# Sidecar Files

Sidecar files are JSON configuration files that sit beside each Grasshopper definition (`.gh`/`.ghx`) in the `src/files/` or `src/pages/cnc/scripts/` directory. They share the same base name as the definition — for example, `My Script.gh` would have a sidecar file named `My Script.json`.

These files are optional. When present, their properties are read at startup by `definitions.js` and injected into the definition metadata served to the frontend.

## Schema

All fields are optional. Only include the properties you need.

```jsonc
{
  // Human-readable description shown on the landing page tooltip
  // and the definition info endpoint.
  "description": "string",

  // Date the definition was created or last updated (free-form string).
  "date": "YYYY-MM-DD",

  // Version string for this definition.
  "version": "string",

  // Initial Three.js camera position and look-at target.
  // Coordinates are in Rhino model units (typically inches).
  "camera": {
    "position": [x, y, z],   // Camera position in 3D space
    "target":   [x, y, z]    // Point the camera looks at
  },

  // Name of the DaisyUI theme to apply when the page loads.
  // Must match a key in public/daisy-themes.json.
  "defaultTheme": "string",

  // Configure the Three.js ground-plane grid.
  "grid": {
    "visible": true,        // Show or hide the grid (default: true)
    "linesX": 100,          // Grid size along X axis (default: 100)
    "linesY": 100,          // Grid size along Y axis (default: 100)
    "axisMarkers": true     // Show colored X/Y axis lines (default: true)
  },

  // Array of .3dm filenames to load as static context geometry.
  // Files must be placed in src/files/.
  "defaultModels": [
    "context.3dm"
  ],

  // Override specific Grasshopper input parameters with dropdown menus
  // instead of sliders/number inputs. Keys must match the Hops parameter
  // name exactly. Values are objects mapping display labels to integer values.
  "dropdowns": {
    "Parameter Name": {
      "Choice Label A": 0,
      "Choice Label B": 1,
      "Choice Label C": 2
    }
  }
}
```

## Full Example

```json
{
  "description": "Parametric Master Plan for Urban Development.",
  "date": "2026-03-04",
  "version": "1.0",
  "camera": {
    "position": [-680, 940, -1200],
    "target": [-60, 10, 120]
  },
  "defaultTheme": "cyberpunk",
  "grid": {
    "visible": false
  },
  "defaultModels": [
    "site_context.3dm"
  ],
  "dropdowns": {
    "Grid Type": {
      "Voronoi": 0,
      "Hex": 1
    },
    "Path Type": {
      "Complete Graph": 0,
      "Delaunay": 1,
      "Geometric Span": 2
    }
  }
}
```

## Minimal Example

A bare-minimum sidecar for a simple experiment:

```json
{
  "description": "A simple test Grasshopper file.",
  "date": "2026-01-06",
  "version": "1.0.0"
}
```

## Where Sidecar Data Appears

| Property | Landing Page | Definition Page | `/definition/:name/info` API |
|---|---|---|---|
| `description` | Tooltip | — | ✓ |
| `date` | Tooltip | — | — |
| `version` | Tooltip | — | — |
| `camera` | — | Initial camera position | ✓ |
| `defaultTheme` | — | Initial UI theme | ✓ |
| `grid` | — | Ground-plane configuration | ✓ |
| `defaultModels` | — | Loaded as static 3D context | ✓ |
| `dropdowns` | — | Replaces sliders with dropdowns | ✓ |
