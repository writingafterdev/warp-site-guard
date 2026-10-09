# WARP Site Guard

A small Chrome/Chromium extension that pauses navigation to websites you list. It checks Cloudflare's WARP status before letting the site load. Each site can require WARP **off** or **on**. `paypal.com` is preloaded with WARP **off**; you can edit or remove it.

## Install

1. Open `chrome://extensions` in Chrome or Chromium.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this `warp-site-guard` folder.
4. Pin **WARP Site Guard** and click its icon to edit the website list.

Chrome asks for access to all websites so the extension can guard domains you add later. The extension only redirects the listed domains. It makes one status request to `www.cloudflare.com` when checking WARP, and stores your list locally in Chrome.

## How it works

Chrome's Declarative Net Request rule redirects a listed site's **top-level request** to a temporary extension page before sending that request to the site. The page checks Cloudflare's `warp=on`, `warp=plus`, or `warp=off` value. If the required state matches, the extension checks a second time and **opens the original URL automatically**. Other URLs are checked separately.

If the check fails or the state does not match and automatic switching is off, the site stays paused. Turn WARP on or off in the Mac app, then click **Check again**. With automatic switching enabled, the helper changes WARP and the site opens once the required state is verified.

## Optional automatic switching on macOS

If Cloudflare WARP and `warp-cli` are installed on your Mac, the extension can ask a local helper to connect or disconnect WARP. The helper is optional and changes WARP for **all apps and tabs on the Mac**.

1. Load the extension as above, then open `chrome://extensions` and copy **WARP Site Guard**'s 32-letter ID.
2. Open Terminal in this folder and run `chmod +x native-host/install-macos.sh` followed by `./native-host/install-macos.sh YOUR_EXTENSION_ID`. If you use Chromium, add `chromium` at the end of the install command.
3. Restart Chrome. In the extension popup, check **Auto-switch Mac WARP** for the websites where you want it.

The installer copies a small Python helper to your user account and registers it only for your extension ID. It only accepts `connect` and `disconnect` commands for Cloudflare's `warp-cli`. The extension verifies the WARP state before opening the site. If the helper fails, use the Cloudflare app manually and click **Check again**.

## Limits

- This detects **Cloudflare WARP** through the browser's route to Cloudflare. It cannot detect all VPNs, DNS-only 1.1.1.1 use, or a site's own VPN rules.
- The guard applies to new top-level navigations. A site already open can keep making requests when WARP changes. Close sensitive tabs before changing WARP.
- A site's sign-in flow can use other domains. Add those domains if you need them guarded too.
- Automatic switching requires the optional local helper. It cannot be scoped to one Chrome tab because the Mac WARP connection is system-wide.
- The extension cannot guarantee that a website will or will not restrict an account.

## Verification

The navigation guard was tested in Chrome for Testing 155 with a local test website. The test website received zero requests while the guard page was open, then received the intended request after the matching WARP state was verified. The new automatic opening path and its failure cases were checked with scripted tests. The Mac helper installer and its restricted command parser were also checked locally; automatic connect/disconnect was not run against the live WARP app during testing.

Run the scripted gate tests with `node tests/gate.test.js`. They use only Node.js built-ins.
