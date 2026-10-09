#!/usr/bin/python3
"""Minimal Chrome native messaging host for Cloudflare WARP on macOS."""

import json
import os
import struct
import subprocess
import sys


CLI_PATHS = (
    "/usr/local/bin/warp-cli",
    "/opt/homebrew/bin/warp-cli",
    "/Applications/Cloudflare WARP.app/Contents/Resources/warp-cli",
)


def reply(message):
    payload = json.dumps(message, separators=(",", ":")).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(payload)))
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()


def main():
    header = sys.stdin.buffer.read(4)
    if len(header) != 4:
        return
    size = struct.unpack("<I", header)[0]
    if size > 8192:
        reply({"ok": False, "error": "Message too large."})
        return
    data = sys.stdin.buffer.read(size)
    try:
        request = json.loads(data)
    except (ValueError, UnicodeDecodeError):
        reply({"ok": False, "error": "Invalid request."})
        return
    command = request.get("command") if isinstance(request, dict) else None
    if command not in ("connect", "disconnect"):
        reply({"ok": False, "error": "Unsupported command."})
        return
    cli = next((path for path in CLI_PATHS if os.access(path, os.X_OK)), None)
    if cli is None:
        reply({"ok": False, "error": "Cloudflare warp-cli was not found on this Mac."})
        return
    try:
        result = subprocess.run(
            [cli, command], capture_output=True, text=True, timeout=15, check=False
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        reply({"ok": False, "error": str(error)[:400]})
        return
    if result.returncode:
        detail = (result.stderr or result.stdout or "warp-cli failed").strip()[:400]
        reply({"ok": False, "error": detail})
        return
    reply({"ok": True})


if __name__ == "__main__":
    main()
