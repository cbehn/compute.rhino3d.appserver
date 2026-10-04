#!/usr/bin/env python3
"""
Secure Token Setter for Rhino Compute
Accepts large/long tokens with masked asterisk (*) feedback.
Saves securely to src2/.env with restricted permissions (0600).
"""

import os
import sys
import tty
import termios
import select

def get_masked_input(prompt="Paste your Rhino Token: "):
    if not sys.stdin.isatty():
        # Fallback if stdin is piped
        return sys.stdin.read().strip()

    sys.stdout.write(prompt)
    sys.stdout.flush()

    fd = sys.stdin.fileno()
    old_settings = termios.tcgetattr(fd)
    chars = []

    try:
        tty.setraw(fd)
        while True:
            # Check for available input with high responsiveness
            r, _, _ = select.select([sys.stdin], [], [], 0.05)
            if not r:
                continue

            chunk = os.read(fd, 4096)
            if not chunk:
                break

            for byte in chunk:
                ch = chr(byte)
                if ch in ('\r', '\n'):
                    sys.stdout.write('\r\n')
                    sys.stdout.flush()
                    return "".join(chars).strip()
                elif ch in ('\x03', '\x04'):  # Ctrl+C or Ctrl+D
                    sys.stdout.write('\r\nCancelled.\r\n')
                    sys.stdout.flush()
                    sys.exit(1)
                elif ch in ('\x7f', '\x08'):  # Backspace
                    if chars:
                        chars.pop()
                        sys.stdout.write('\b \b')
                else:
                    chars.append(ch)
                    sys.stdout.write('*')
            sys.stdout.flush()

    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)

def save_token(token):
    if not token:
        print("❌ Error: No token provided. Aborting.")
        sys.exit(1)

    # Determine src2 directory path
    script_dir = os.path.dirname(os.path.abspath(__file__))
    src2_dir = os.path.dirname(script_dir)
    env_file = os.path.join(src2_dir, ".env")

    # Read existing .env if present
    lines = []
    found = False
    if os.path.exists(env_file):
        with open(env_file, "r") as f:
            for line in f:
                if line.startswith("RHINO_TOKEN="):
                    lines.append(f'RHINO_TOKEN="{token}"\n')
                    found = True
                else:
                    lines.append(line)

    if not found:
        lines.append(f'RHINO_TOKEN="{token}"\n')

    # Write securely
    with open(env_file, "w") as f:
        f.writelines(lines)

    # Restrict permissions: read/write by owner only (0600)
    os.chmod(env_file, 0o600)

    token_len = len(token)
    preview = f"{token[:4]}...{token[-4:]}" if token_len > 10 else "***"

    print("=" * 60)
    print("✅ RHINO_TOKEN successfully configured in src2/.env!")
    print(f"   • Total token length: {token_len} characters")
    print(f"   • Masked preview:     {preview}")
    print(f"   • File permissions:   0600 (Restricted to your user account)")
    print("=" * 60)
    print("\nNext step: restart your local container to apply the token:")
    print("  cd src2 && docker compose up -d\n")

if __name__ == "__main__":
    try:
        token = get_masked_input("🔑 Paste your Rhino Token (press Enter when finished): ")
        save_token(token)
    except KeyboardInterrupt:
        print("\nCancelled.")
        sys.exit(1)
