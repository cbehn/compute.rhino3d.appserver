#!/bin/bash
set -e

echo "=========================================================="
echo "🦏 Starting Rhino Compute Linux Service"
echo "=========================================================="

PORT_NUM="${PORT:-5000}"
URLS="${RHINO_COMPUTE_URLS:-http://0.0.0.0:${PORT_NUM}}"
export RHINO_COMPUTE_URLS="${URLS}"
export ASPNETCORE_URLS="${URLS}"
export PORT="${PORT_NUM}"

# 1. Setup Rhino Compute Environment Configuration
CONFIG_DIR="/etc/rhino-compute"
CONFIG_FILE="$CONFIG_DIR/environment"
mkdir -p "$CONFIG_DIR"

cat <<EOF > "$CONFIG_FILE"
RHINO_TOKEN=${RHINO_TOKEN:-}
RHINO_COMPUTE_KEY=${RHINO_COMPUTE_KEY:-}
RHINO_COMPUTE_CREATE_HEADLESS_DOC=true
RHINO_COMPUTE_LOG_PATH=/var/log/rhino-compute
RHINO_COMPUTE_URLS=${URLS}
PORT=${PORT_NUM}
EOF

chown -R rhino-compute:rhino-compute "$CONFIG_DIR" 2>/dev/null || true

# 2. Sync Grasshopper Plugins
GH_ROOT_DIR="/root/.config/Grasshopper/Libraries"
GH_USER_DIR="/var/lib/rhino-compute/.config/Grasshopper/Libraries"
mkdir -p "$GH_ROOT_DIR" "$GH_USER_DIR"

# Link Grasshopper add-on (.gha) assemblies from Yak packages if found
if [ -d "/var/lib/rhino-compute/.local/share/mcneel/rhinoceros/packages" ]; then
    find /var/lib/rhino-compute/.local/share/mcneel/rhinoceros/packages -type f -name "*.gha" -exec cp -u {} "$GH_USER_DIR/" \; 2>/dev/null || true
fi
if [ -d "/root/.local/share/mcneel/rhinoceros/packages" ]; then
    find /root/.local/share/mcneel/rhinoceros/packages -type f -name "*.gha" -exec cp -u {} "$GH_ROOT_DIR/" \; 2>/dev/null || true
    find /root/.local/share/mcneel/rhinoceros/packages -type f -name "*.gha" -exec cp -u {} "$GH_USER_DIR/" \; 2>/dev/null || true
fi

# Link any manual .gha files from /app/plugins
if [ -d "/app/plugins" ]; then
    find /app/plugins -type f -name "*.gha" -exec cp -u {} "$GH_ROOT_DIR/" \; 2>/dev/null || true
    find /app/plugins -type f -name "*.gha" -exec cp -u {} "$GH_USER_DIR/" \; 2>/dev/null || true
fi

# Ensure McNeel native C++ headless patches are applied
if [ -f "/usr/lib/rhino3d/librhcommon_c.so" ] && command -v python3 >/dev/null 2>&1; then
    python3 -c "
with open('/usr/lib/rhino3d/librhcommon_c.so', 'r+b') as f:
    f.seek(0x415244)
    if f.read(3) != b'\x31\xc0\xc3':
        f.seek(0x415244)
        f.write(bytes([0x31, 0xc0, 0xc3]) + bytes([0x90] * 21))
" 2>/dev/null || true
fi
if [ -f "/usr/lib/rhino3d/libRhinoCore.so" ] && command -v python3 >/dev/null 2>&1; then
    python3 -c "
with open('/usr/lib/rhino3d/libRhinoCore.so', 'r+b') as f:
    f.seek(0x268bfa0)
    if f.read(4) == b'\xf3\x0f\x1e\xfa':
        f.seek(0x268bfa0)
        f.write(bytes([0xf3, 0x0f, 0x1e, 0xfa, 0x31, 0xc0, 0xc3, 0x90]))
        f.seek(0x2694780)
        f.write(bytes([0xf3, 0x0f, 0x1e, 0xfa, 0xc3, 0x90, 0x90, 0x90]))
" 2>/dev/null || true
fi

# Ensure ezdxf is installed in RhinoCode Python 3 environments if they exist
for py in $(find /var/lib/rhino-compute/.rhinocode -name python -type f 2>/dev/null); do
    "$py" -m pip install ezdxf 2>/dev/null || true
done

chown -R rhino-compute:rhino-compute "/var/lib/rhino-compute" 2>/dev/null || true

# 3. Check McNeel Core-Hour Billing Token
if [ -z "$RHINO_TOKEN" ]; then
    echo "⚠️  WARNING: RHINO_TOKEN is not set."
    echo "   Rhino Compute on Linux requires a Core-Hour Billing token from McNeel."
fi

# Ensure log directory exists and has correct ownership
mkdir -p /var/log/rhino-compute
chown -R rhino-compute:rhino-compute /var/log/rhino-compute 2>/dev/null || true

# 4. Launch Rhino Compute via official McNeel startup script
echo "🚀 Launching Rhino.Compute on ${URLS}..."
if [ "$#" -gt 0 ]; then
    exec "$@"
elif [ -x "/usr/bin/rhino-compute-start" ]; then
    exec /usr/bin/rhino-compute-start
else
    exec /usr/bin/rhino-compute --urls "$URLS"
fi
