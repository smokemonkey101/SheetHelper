const toast = document.querySelector("#toast");
let driveConnected = false;

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.className = `toast show${isError ? " error" : ""}`;
  setTimeout(() => { toast.className = "toast"; }, 4000);
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Something went wrong.");
  return payload;
}

function setRailwayStatus(name, configured) {
  const indicator = document.querySelector(`#${name}Indicator`);
  const status = document.querySelector(`#${name}Status`);
  const row = indicator.closest(".configuration-status");
  row.classList.toggle("configured", configured);
  status.textContent = configured ? "Configured in Railway" : "Missing Railway variable";
}

async function loadSettings() {
  try {
    const status = await request("/api/settings/status");
    document.querySelector("#settingsLockScreen").hidden = !status.locked;
    if (status.locked) return;

    const config = await request("/api/config");
    const railway = config.railwayConfiguration || {};
    setRailwayStatus("spreadsheet", Boolean(railway.spreadsheet));
    setRailwayStatus("serviceAccount", Boolean(railway.serviceAccount));
    setRailwayStatus("oauthClient", Boolean(railway.oauthClient));
    setRailwayStatus("driveFolder", Boolean(railway.driveFolder));
    document.querySelector("#googleOAuthRedirectUri").value = config.googleOAuthRedirectUri || "";

    driveConnected = Boolean(config.driveOAuthConnected);
    const managedByRailway = Boolean(config.driveManagedByRailway);
    const card = document.querySelector("#driveConnectionCard");
    card.classList.toggle("connected", driveConnected);
    document.querySelector("#driveConnectionTitle").textContent = driveConnected
      ? "Personal Google Drive connected"
      : "Not connected";
    document.querySelector("#driveConnectionDetail").textContent = managedByRailway
      ? "Drive authorization is managed by a Railway variable."
      : driveConnected
        ? "Uploads are saved in your MHC Tools Uploads folder."
        : "OAuth creates an MHC Tools Uploads folder in My Drive.";

    const connectButton = document.querySelector("#connectDrive");
    const disconnectButton = document.querySelector("#disconnectDrive");
    connectButton.hidden = managedByRailway;
    connectButton.textContent = driveConnected ? "Reconnect Google Drive" : "Connect Google Drive";
    disconnectButton.hidden = managedByRailway || !driveConnected;
  } catch (error) {
    showToast(error.message, true);
  }
}

document.querySelector("#settingsUnlockForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const unlockForm = event.currentTarget;
  const button = unlockForm.querySelector("button[type=submit]");
  button.disabled = true;
  button.textContent = "Unlocking…";
  try {
    await request("/api/settings/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(unlockForm)))
    });
    document.querySelector("#settingsLockScreen").hidden = true;
    unlockForm.reset();
    await loadSettings();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "Unlock settings";
  }
});

document.querySelector("#connectDrive").addEventListener("click", () => {
  window.location.assign("/api/google-drive/oauth/start");
});

document.querySelector("#disconnectDrive").addEventListener("click", async () => {
  const button = document.querySelector("#disconnectDrive");
  button.disabled = true;
  try {
    await request("/api/google-drive/oauth/disconnect", { method: "POST" });
    showToast("Google Drive disconnected.");
    await loadSettings();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#copyRedirectUri").addEventListener("click", async () => {
  const value = document.querySelector("#googleOAuthRedirectUri").value;
  try {
    await navigator.clipboard.writeText(value);
    showToast("Redirect URI copied.");
  } catch {
    showToast("Select and copy the redirect URI manually.", true);
  }
});

(async () => {
  await loadSettings();
  const params = new URLSearchParams(window.location.search);
  const driveResult = params.get("drive");
  if (driveResult === "connected") showToast("Personal Google Drive connected.");
  if (driveResult === "error") showToast(params.get("message") || "Google Drive connection failed.", true);
  if (driveResult) window.history.replaceState({}, "", "/settings");
})();
