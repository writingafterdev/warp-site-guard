const domainEl = document.querySelector("#domain");
const requiredEl = document.querySelector("#required");
const statusEl = document.querySelector("#status");
const explanationEl = document.querySelector("#explanation");
const retryButton = document.querySelector("#retry");
const target = location.hash.slice(1);
let site = null;

function show(status, kind, explanation) {
  statusEl.textContent = status;
  statusEl.className = `status ${kind}`;
  explanationEl.textContent = explanation;
}

function send(message) {
  return chrome.runtime.sendMessage(message).then(reply => {
    if (reply?.error) throw new Error(reply.error);
    return reply;
  });
}

function pause(status, explanation) {
  show(status, "danger", explanation);
  retryButton.hidden = false;
  retryButton.disabled = false;
}

async function openSite() {
  show("Verifying once more…", "checking", "The website has not been opened yet.");
  try {
    const reply = await send({ type: "proceed", target });
    if (!reply.allowed) {
      pause(`WARP is ${reply.warp.state} · change it first`,
        `Turn WARP ${reply.required} in the Cloudflare app, then check again.`);
      return;
    }
    show("Opening website…", "good", "");
    location.replace(target);
  } catch (error) {
    pause("Could not open website", error.message);
  }
}

async function refresh() {
  retryButton.hidden = true;
  retryButton.disabled = true;
  show("Checking and setting Cloudflare WARP…", "checking", "This can take a few seconds.");
  try {
    const result = await send({ type: "prepare", target });
    const state = result.warp.state;
    if (state === "unknown") {
      pause("Could not verify WARP", result.error || "Check your internet connection, then try again. Access stays paused when the check fails.");
    } else if (state === site.required) {
      await openSite();
    } else {
      pause(`WARP is ${state} · change it first`,
        result.error || `Use the Cloudflare WARP app on your Mac to turn WARP ${site.required}, then check again.`);
    }
  } catch (error) {
    pause("Could not verify WARP", error.message);
  }
}

async function init() {
  let url;
  try { url = new URL(target); } catch { /* Show an invalid-link message below. */ }
  if (!url || !["http:", "https:"].includes(url.protocol)) {
    show("Invalid website link", "danger", "Open a website from your protected list again.");
    return;
  }
  domainEl.textContent = url.hostname;
  try {
    const { sites } = await send({ type: "getSites" });
    site = sites.find(item => url.hostname === item.domain || url.hostname.endsWith(`.${item.domain}`));
    if (!site) throw new Error("This website is no longer on your protected list.");
    requiredEl.textContent = `WARP ${site.required}`;
    await refresh();
  } catch (error) {
    show("Could not load this website", "danger", error.message);
  }
}

retryButton.addEventListener("click", refresh);
init();
