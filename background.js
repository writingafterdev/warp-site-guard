const DEFAULT_SITES = [{ domain: "paypal.com", required: "off", auto: false }];
const TRACE_URL = "https://www.cloudflare.com/cdn-cgi/trace";
const MAX_SITES = 30;
let changes = Promise.resolve();

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeDomain(input) {
  if (typeof input !== "string" || !input.trim()) throw new Error("Enter a website domain.");
  let parsed;
  try {
    parsed = new URL(input.includes("://") ? input.trim() : `https://${input.trim()}`);
  } catch {
    throw new Error("Enter a valid domain, such as example.com.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https websites are supported.");
  }
  if (parsed.username || parsed.password) throw new Error("Enter a domain without a username or password.");
  const domain = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const labels = domain.split(".");
  if (domain.length > 253 || labels.length < 2 || labels.some(label =>
    label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ) || /^\d+(?:\.\d+){3}$/.test(domain)) {
    throw new Error("Enter a public website domain, such as example.com.");
  }
  return domain;
}

function validSites(sites) {
  if (!Array.isArray(sites) || sites.length > MAX_SITES) throw new Error("Too many websites.");
  const unique = new Set();
  return sites.map(site => {
    const domain = normalizeDomain(site.domain);
    if (unique.has(domain)) throw new Error(`Duplicate domain: ${domain}`);
    unique.add(domain);
    if (!["on", "off"].includes(site.required)) throw new Error("Invalid WARP setting.");
    return { domain, required: site.required, auto: site.auto === true };
  });
}

async function getSites() {
  const { sites } = await chrome.storage.local.get("sites");
  if (sites === undefined) {
    await chrome.storage.local.set({ sites: DEFAULT_SITES });
    return DEFAULT_SITES;
  }
  return validSites(sites);
}

function makeRule(site, index) {
  const domain = escapeRegex(site.domain);
  return {
    id: index + 1,
    priority: 1,
    action: {
      type: "redirect",
      redirect: { regexSubstitution: `${chrome.runtime.getURL("gate.html")}#\\0` }
    },
    condition: {
      regexFilter: `^https?://(?:[a-z0-9-]+\\.)*${domain}(?::[0-9]+)?(?:[/?#].*)?$`,
      resourceTypes: ["main_frame"]
    }
  };
}

async function syncRules(sites) {
  const old = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: old.map(rule => rule.id),
    addRules: sites.map(makeRule)
  });
}

function queueChange(task) {
  const result = changes.then(task);
  changes = result.catch(() => {});
  return result;
}

async function updateSites(sites) {
  const checked = validSites(sites);
  await syncRules(checked);
  await chrome.storage.local.set({ sites: checked });
  return checked;
}

async function checkWarp() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`${TRACE_URL}?guard=${Date.now()}`, {
      cache: "no-store", credentials: "omit", redirect: "error", signal: controller.signal
    });
    if (!response.ok) throw new Error("Cloudflare check failed.");
    const trace = await response.text();
    const value = /^warp=(on|off|plus)$/m.exec(trace)?.[1];
    if (!value) throw new Error("Cloudflare did not return WARP status.");
    return { state: value === "off" ? "off" : "on", detail: value };
  } catch (error) {
    return { state: "unknown", detail: error.message || "Network check failed." };
  } finally {
    clearTimeout(timeout);
  }
}

async function prepareSite(site) {
  let warp = await checkWarp();
  if (warp.state === site.required || !site.auto) return { warp };
  if (warp.state === "unknown") return { warp, error: "Cloudflare could not verify WARP, so auto-switch was skipped." };
  try {
    const reply = await chrome.runtime.sendNativeMessage(
      "com.warp_site_guard.helper", { command: site.required === "on" ? "connect" : "disconnect" }
    );
    if (!reply?.ok) throw new Error(reply?.error || "Mac helper failed.");
    for (let attempt = 0; attempt < 18; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      warp = await checkWarp();
      if (warp.state === site.required) return { warp, switched: true };
    }
    return { warp, error: "WARP did not reach the required state. Check the Cloudflare app and try again." };
  } catch (error) {
    return { warp, error: `Auto-switch unavailable: ${error.message}` };
  }
}

function siteForUrl(target, sites) {
  let url;
  try { url = new URL(target); } catch { return null; }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  return sites.find(site => host === site.domain || host.endsWith(`.${site.domain}`)) || null;
}

async function handleMessage(message, sender) {
  if (message?.type === "getSites") return { sites: await getSites() };
  if (message?.type === "saveSites") {
    return { sites: await queueChange(() => updateSites(message.sites)) };
  }
  if (message?.type === "check") return { warp: await checkWarp() };
  if (message?.type === "prepare") {
    if (!sender.tab?.id || !sender.url?.startsWith(chrome.runtime.getURL("gate.html"))) {
      throw new Error("Open a guarded site to check it.");
    }
    const site = siteForUrl(message.target, await getSites());
    if (!site) throw new Error("This website is no longer on your list.");
    return prepareSite(site);
  }
  if (message?.type === "proceed") {
    if (!sender.tab?.id || !sender.url?.startsWith(chrome.runtime.getURL("gate.html"))) {
      throw new Error("Open a guarded site to continue.");
    }
    const target = message.target;
    const site = siteForUrl(target, await getSites());
    if (!site) throw new Error("This website is no longer on your list.");
    const { warp } = await prepareSite(site);
    if (warp.state !== site.required) return { allowed: false, warp, required: site.required };
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    const tabId = sender.tab.id;
    const old = rules.filter(rule => rule.condition.tabIds?.includes(tabId)).map(rule => rule.id);
    const id = tabId + 100000;
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: old,
      addRules: [{
        id, priority: 2, action: { type: "allow" },
        condition: {
          regexFilter: `^${escapeRegex(target)}$`,
          resourceTypes: ["main_frame"], tabIds: [tabId]
        }
      }]
    });
    await chrome.alarms.create(`allow-${tabId}`, { delayInMinutes: 0.5 });
    return { allowed: true, warp, target };
  }
  throw new Error("Unknown request.");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse, error => sendResponse({ error: error.message }));
  return true;
});

async function removeTabRules(tabId) {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  const ids = rules.filter(rule => rule.condition.tabIds?.includes(tabId)).map(rule => rule.id);
  if (ids.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids });
}

chrome.webNavigation.onCommitted.addListener(details => {
  if (details.frameId === 0 && !details.url.startsWith(chrome.runtime.getURL("gate.html"))) {
    removeTabRules(details.tabId).catch(console.error);
  }
});
chrome.tabs.onRemoved.addListener(tabId => removeTabRules(tabId).catch(console.error));
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name.startsWith("allow-")) {
    const tabId = Number(alarm.name.slice(6));
    if (Number.isInteger(tabId)) removeTabRules(tabId).catch(console.error);
  }
});
chrome.runtime.onInstalled.addListener(() => queueChange(async () => syncRules(await getSites())).catch(console.error));
chrome.runtime.onStartup.addListener(() => queueChange(async () => {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  if (rules.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map(rule => rule.id) });
  await syncRules(await getSites());
}).catch(console.error));
