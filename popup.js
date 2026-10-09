const list = document.querySelector("#sites");
const form = document.querySelector("#add-form");
const messageEl = document.querySelector("#message");
const statusEl = document.querySelector("#warp-status");
let sites = [];

function send(message) {
  return chrome.runtime.sendMessage(message).then(reply => {
    if (reply?.error) throw new Error(reply.error);
    return reply;
  });
}

function render() {
  list.replaceChildren();
  for (const site of sites) {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = site.domain;
    const control = document.createElement("select");
    control.setAttribute("aria-label", `Required WARP state for ${site.domain}`);
    for (const value of ["off", "on"]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = `WARP ${value}`;
      control.append(option);
    }
    control.value = site.required;
    control.addEventListener("change", async () => {
      await save(sites.map(entry => entry.domain === site.domain ? { ...entry, required: control.value } : entry));
    });
    const auto = document.createElement("label");
    auto.className = "auto-toggle";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = site.auto === true;
    check.setAttribute("aria-label", `Automatically switch Mac WARP for ${site.domain}`);
    check.addEventListener("change", async () => {
      await save(sites.map(entry => entry.domain === site.domain ? { ...entry, auto: check.checked } : entry));
    });
    auto.append(check, document.createTextNode("Auto-switch Mac WARP"));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${site.domain}`);
    remove.addEventListener("click", () => save(sites.filter(entry => entry.domain !== site.domain)));
    const row = document.createElement("div");
    row.className = "site-row";
    row.append(name, control, remove);
    item.append(row, auto);
    list.append(item);
  }
  if (!sites.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No websites yet. Add one below.";
    list.append(empty);
  }
}

async function save(next) {
  messageEl.textContent = "Saving…";
  try {
    const reply = await send({ type: "saveSites", sites: next });
    sites = reply.sites;
    render();
    messageEl.textContent = "Saved.";
  } catch (error) {
    messageEl.textContent = error.message;
    render();
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const domainInput = document.querySelector("#domain");
  const domain = domainInput.value;
  const required = document.querySelector("#required").value;
  await save([...sites, { domain, required, auto: false }]);
  if (messageEl.textContent === "Saved.") domainInput.value = "";
});

async function init() {
  try {
    sites = (await send({ type: "getSites" })).sites;
    render();
    const { warp } = await send({ type: "check" });
    statusEl.textContent = warp.state === "unknown" ? "WARP status unavailable" : `Cloudflare WARP is ${warp.state}`;
    statusEl.className = `status ${warp.state === "unknown" ? "danger" : "good"}`;
  } catch (error) {
    messageEl.textContent = error.message;
    statusEl.textContent = "Could not check WARP";
    statusEl.className = "status danger";
  }
}
init();
