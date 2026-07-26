const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const toast = $("#toast");
let toastTimer;

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast show${isError ? " error" : ""}`;
  toastTimer = setTimeout(() => { toast.className = "toast"; }, 4500);
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (payload.locked) $("#lockScreen").hidden = false;
    throw new Error(payload.error || "Something went wrong.");
  }
  return payload;
}

function setBusy(form, busy, label) {
  const button = $("button[type=submit]", form);
  if (!button.dataset.label) button.dataset.label = button.innerHTML;
  button.disabled = busy;
  button.innerHTML = busy ? label : button.dataset.label;
}

async function loadStatus() {
  const status = await request("/api/status");
  $("#lockScreen").hidden = !status.locked;
  $("#connectionStatus").className = `status${status.ready ? " ready" : ""}`;
  $("#connectionStatus").innerHTML = `<i></i> ${status.ready ? "Google connected" : "Setup needed"}`;
  return status;
}

async function loadJobs() {
  const selects = $$(".job-select");
  selects.forEach((select) => { select.innerHTML = '<option value="">Loading jobs…</option>'; });
  try {
    const { jobs } = await request("/api/jobs");
    const options = ['<option value="">Choose a job</option>', ...jobs.map((job) => {
      const option = document.createElement("option");
      option.value = job;
      option.textContent = job;
      return option.outerHTML;
    })].join("");
    selects.forEach((select) => { select.innerHTML = options; });
    if (!jobs.length) showToast("Add job names to Jobs column A in your Google Sheet.", true);
  } catch (error) {
    selects.forEach((select) => { select.innerHTML = '<option value="">Jobs unavailable</option>'; });
    showToast(error.message, true);
  }
}

async function imageToJpeg(file) {
  if (file.type === "image/jpeg" && file.size <= 15 * 1024 * 1024) return file;
  const bitmap = await createImageBitmap(file);
  const maxDimension = 2400;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("Could not prepare that image.")),
    "image/jpeg",
    .88
  ));
}

$("#photoFiles").addEventListener("change", (event) => {
  const files = [...event.target.files];
  $("#photoFileLabel").textContent = files.length ? `${files.length} photo${files.length === 1 ? "" : "s"} selected` : "JPG, PNG, or camera photos";
});

$("#receiptFile").addEventListener("change", (event) => {
  $("#receiptFileLabel").textContent = event.target.files[0]?.name || "Make sure the total is clearly visible";
});

$("#reportForm textarea").addEventListener("input", (event) => {
  $("#reportCount").textContent = event.target.value.length.toLocaleString();
});

$("#photoForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const job = new FormData(form).get("job");
  const files = [...$("#photoFiles").files];
  if (!files.length) return showToast("Choose at least one photo.", true);
  setBusy(form, true, `Preparing 1 of ${files.length}…`);
  try {
    for (let index = 0; index < files.length; index += 1) {
      const image = await imageToJpeg(files[index]);
      $("button[type=submit]", form).textContent = `Uploading ${index + 1} of ${files.length}…`;
      await request("/api/photos", {
        method: "POST",
        headers: {
          "Content-Type": "image/jpeg",
          "X-Job": encodeURIComponent(job),
          "X-Photo-Index": String(index + 1)
        },
        body: image
      });
    }
    form.reset();
    $("#photoFileLabel").textContent = "JPG, PNG, or camera photos";
    showToast(`${files.length} photo${files.length === 1 ? "" : "s"} added to ${job}.`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(form, false);
  }
});

$("#reportForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  setBusy(form, true, "Saving report…");
  try {
    await request("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    form.reset();
    $("#reportCount").textContent = "0";
    showToast(`Report saved for ${data.job}.`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(form, false);
  }
});

$("#receiptForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const job = new FormData(form).get("job");
  const file = $("#receiptFile").files[0];
  if (!file) return showToast("Choose one receipt photo.", true);
  setBusy(form, true, "Reading receipt…");
  try {
    const image = await imageToJpeg(file);
    const result = await request("/api/receipts", {
      method: "POST",
      headers: { "Content-Type": "image/jpeg", "X-Job": encodeURIComponent(job) },
      body: image
    });
    form.reset();
    $("#receiptFileLabel").textContent = "Make sure the total is clearly visible";
    showToast(`Receipt added to ${job}${result.total ? ` — total $${result.total}` : ""}.`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(form, false);
  }
});

$("#unlockForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  setBusy(form, true, "Unlocking…");
  try {
    await request("/api/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });
    $("#lockScreen").hidden = true;
    form.reset();
    await loadStatus();
    await loadJobs();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(form, false);
  }
});

$("#refreshJobs").addEventListener("click", loadJobs);
$("#refreshJobsText").addEventListener("click", loadJobs);

(async () => {
  try {
    const status = await loadStatus();
    if (!status.locked) await loadJobs();
  } catch (error) {
    showToast(error.message, true);
  }
})();
