#!/bin/sh
set -eu

extension_id=${1:-}
browser=${2:-chrome}
case "$extension_id" in
  *[!a-p]*|'') echo "Usage: ./install-macos.sh EXTENSION_ID [chrome|chromium]" >&2; exit 1 ;;
esac
if [ "${#extension_id}" -ne 32 ]; then
  echo "The Chrome extension ID must be 32 letters." >&2
  exit 1
fi
case "$browser" in
  chrome|chromium) ;;
  *) echo "Choose chrome or chromium." >&2; exit 1 ;;
esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
/usr/bin/python3 - "$script_dir" "$extension_id" "$browser" <<'PY'
import json
import os
import shutil
import sys

source, extension_id, browser = sys.argv[1:]
support = os.path.expanduser("~/Library/Application Support/WARPSiteGuard")
relative_dir = "Google/Chrome" if browser == "chrome" else "Chromium"
manifest_dir = os.path.expanduser(f"~/Library/Application Support/{relative_dir}/NativeMessagingHosts")
os.makedirs(support, mode=0o700, exist_ok=True)
os.makedirs(manifest_dir, mode=0o700, exist_ok=True)
host_path = os.path.join(support, "warp_site_guard.py")
shutil.copyfile(os.path.join(source, "warp_site_guard.py"), host_path)
os.chmod(host_path, 0o700)
manifest = {
    "name": "com.warp_site_guard.helper",
    "description": "Connect or disconnect Cloudflare WARP for WARP Site Guard",
    "path": host_path,
    "type": "stdio",
    "allowed_origins": [f"chrome-extension://{extension_id}/"],
}
manifest_path = os.path.join(manifest_dir, "com.warp_site_guard.helper.json")
with open(manifest_path, "w", encoding="utf-8") as output:
    json.dump(manifest, output, indent=2)
os.chmod(manifest_path, 0o600)
print(f"Installed WARP Site Guard's optional Mac helper for {browser}.")
print(f"Restart {browser} before using Auto-switch Mac WARP.")
PY
