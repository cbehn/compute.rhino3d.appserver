import os

def patch_file(filepath, offset, new_bytes):
    if not os.path.exists(filepath):
        return
    with open(filepath, 'r+b') as f:
        f.seek(offset)
        f.write(new_bytes)
    print(f"Patched {filepath} at offset {hex(offset)}")

if __name__ == '__main__':
    patch_file('/usr/lib/rhino3d/librhcommon_c.so', 0x415244, bytes([0x31, 0xc0, 0xc3]) + bytes([0x90] * 21))
    patch_file('/usr/lib/rhino3d/libRhinoCore.so', 0x268bfa0, bytes([0xf3, 0x0f, 0x1e, 0xfa, 0x31, 0xc0, 0xc3, 0x90]))
    patch_file('/usr/lib/rhino3d/libRhinoCore.so', 0x2694780, bytes([0xf3, 0x0f, 0x1e, 0xfa, 0xc3, 0x90, 0x90, 0x90]))
