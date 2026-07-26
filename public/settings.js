const form = document.querySelector("#settingsForm");
const toast = document.querySelector("#toast");

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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector("button[type=submit]");
  const status = document.querySelector("#saveStatus");
  button.disabled = true;
  button.textContent = "Saving…";
  status.textContent = "";
  try {
    await request("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });
    status.textContent = "Settings saved";
    showToast("Settings saved.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "Save changes";
  }
});

loadSettings();
