const form = document.querySelector("#settingsForm");
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

async function loadSettings() {
  try {
    const status = await request("/api/settings/status");
    document.querySelector("#settingsLockScreen").hidden = !status.locked;
    if (status.locked) return;
    const config = await request("/api/config");
    for (const [key, value] of Object.entries(config)) {
      if (form.elements[key] && typeof value === "string") form.elements[key].value = value;
    }
    driveConnected = Boolean(config.driveOAuthConnected);
    const card = document.querySelector("#driveConnectionCard");
    card.classList.toggle("connected", driveConnected);
    document.querySelector("#driveConnectionTitle").textContent = driveConnected
      ? "Personal Google Drive connected"
      : "Not connected";
    document.querySelector("#driveConnectionDetail").textContent = driveConnected
      ? "Uploads are saved in your MHC Tools Uploads folder."
      : "OAuth creates an MHC Tools Uploads folder in My Drive.";
    document.querySelector("#connectDrive").textContent = driveConnected
      ? "Reconnect Google Drive"
      : "Connect Google Drive";
    document.querySelector("#disconnectDrive").hidden = !driveConnected;
  } catch (error) {
    showToast(error.message, true);
  }
}

async function saveConfiguration() {
  await request("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.fromEntries(new FormData(form)))
  });
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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector("button[type=submit]");
  const status = document.querySelector("#saveStatus");
  button.disabled = true;
  button.textContent = "Saving…";
  status.textContent = "";
  try {
    await saveConfiguration();
    status.textContent = "Settings saved";
    showToast("Settings saved.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "Save changes";
  }
});

document.querySelector("#connectDrive").addEventListener("click", async () => {
  const button = document.querySelector("#connectDrive");
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    await saveConfiguration();
    window.location.assign("/api/google-drive/oauth/start");
  } catch (error) {
    showToast(error.message, true);
    button.disabled = false;
    button.textContent = driveConnected ? "Reconnect Google Drive" : "Connect Google Drive";
  }
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
