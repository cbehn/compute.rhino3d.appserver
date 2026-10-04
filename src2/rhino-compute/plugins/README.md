# Grasshopper Plugins for Rhino Compute Linux

This directory holds custom Grasshopper plugins (`.gha` and `.dll` assemblies) required by your Grasshopper definitions.

---

## Required Plugins for CNC Tool

The CoLab CNC Setup Tool definitions (such as `cncProfiler-v0.10.0.ghx` and `cncProfiler-v0.9.2.ghx`) require:

- **Miller_Moth**
  - **Assembly**: `MillerMoth, Version=1.0.6.6`
  - **Author**: Timothy Veske-McMahon
  - **Components Used**:
    - `Safeheight Injector` (Inserts Z safe height movements above line endpoints)
    - `Set Milling GCode Stream` (Configures milling G-code operations, arc tolerances, coordinates)
    - `Generate GCode` (Compiles toolpaths and machine settings into CNC G-code)
    - `GCode Visualizer` (Visualizes tool movements)

---

## How to Install Plugins in this Container

1. Copy your compiled `MillerMoth.gha` (or `MillerMoth.dll`) into this folder (`src2/rhino-compute/plugins/`).
2. When the Docker container builds and starts up, `entrypoint.sh` automatically installs all files in this directory into:
   - `/root/.config/Grasshopper/Libraries/`
   - `/usr/share/rhino/Libraries/`
3. Rhino Compute loads these libraries upon initializing the Grasshopper solver.

---

## Compatibility Note for Linux
Grasshopper components running under Rhino Compute Linux use headless .NET runtime. Plugins should avoid referencing Windows Forms (`System.Windows.Forms`) or Windows Presentation Foundation (`WPF`) UI namespaces during compute execution.
