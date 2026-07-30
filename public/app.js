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
  $("#masterFileCard").hidden = status.role !== "master";
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

async function loadTasks() {
  const job = $("#taskJob").value;
  const select = $("#taskSelect");
  if (!job) {
    select.disabled = true;
    select.innerHTML = '<option value="">Choose a job first</option>';
    return;
  }
  select.disabled = true;
  select.innerHTML = '<option value="">Loading tasks…</option>';
  try {
    const { tasks } = await request(`/api/tasks?job=${encodeURIComponent(job)}`);
    const options = ['<option value="">Choose a task</option>', ...tasks.map((task) => {
      const option = document.createElement("option");
      option.value = task.id;
      option.textContent = task.text;
      return option.outerHTML;
    })].join("");
    select.innerHTML = options;
    select.disabled = false;
    if (!tasks.length) showToast(`No tasks are listed to the right of ${job}.`, true);
  } catch (error) {
    select.innerHTML = '<option value="">Tasks unavailable</option>';
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

async function prepareUpload(file) {
  if (!file.type.startsWith("image/")) return file;
  return imageToJpeg(file);
}

$("#photoFiles").addEventListener("change", (event) => {
  const files = [...event.target.files];
  $("#photoFileLabel").textContent = files.length ? `${files.length} file${files.length === 1 ? "" : "s"} selected` : "Images, PDFs, and other files";
});

$("#receiptFile").addEventListener("change", (event) => {
  $("#receiptFileLabel").textContent = event.target.files[0]?.name || "Make sure the total is clearly visible";
});

$("#masterFiles").addEventListener("change", (event) => {
  const files = [...event.target.files];
  $("#masterFileLabel").textContent = files.length ? `${files.length} file${files.length === 1 ? "" : "s"} selected` : "Any file type, up to 20 MB each";
});

$("#reportForm textarea").addEventListener("input", (event) => {
  $("#reportCount").textContent = event.target.value.length.toLocaleString();
});

$("#taskJob").addEventListener("change", loadTasks);

$("#photoForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const job = new FormData(form).get("job");
  const files = [...$("#photoFiles").files];
  if (!files.length) return showToast("Choose at least one file.", true);
  setBusy(form, true, `Preparing 1 of ${files.length}…`);
  try {
    for (let index = 0; index < files.length; index += 1) {
      const upload = await prepareUpload(files[index]);
      $("button[type=submit]", form).textContent = `Uploading ${index + 1} of ${files.length}…`;
      await request("/api/photos", {
        method: "POST",
        headers: {
          "Content-Type": upload.type || "application/octet-stream",
          "X-Job": encodeURIComponent(job),
          "X-Photo-Index": String(index + 1),
          "X-File-Name": encodeURIComponent(files[index].name)
        },
        body: upload
      });
    }
    form.reset();
    $("#photoFileLabel").textContent = "Images, PDFs, and other files";
    showToast(`${files.length} file${files.length === 1 ? "" : "s"} added to ${job}.`);
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
    const upload = await prepareUpload(file);
    const result = await request("/api/receipts", {
      method: "POST",
      headers: {
        "Content-Type": upload.type || "application/octet-stream",
        "X-Job": encodeURIComponent(job),
        "X-File-Name": encodeURIComponent(file.name)
      },
      body: upload
    });
    form.reset();
    $("#receiptFileLabel").textContent = "Make sure the total is clearly visible";
    showToast(result.ocrSkipped
      ? `Receipt file added to ${job}. Automatic reading currently works with images only.`
      : `Receipt added to ${job}${result.total ? ` — total $${result.total}` : ""}.`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(form, false);
  }
});

$("#masterFileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const job = data.get("job");
  const type = data.get("type");
  const files = [...$("#masterFiles").files];
  if (!files.length) return showToast("Choose at least one file.", true);
  setBusy(form, true, `Uploading 1 of ${files.length}…`);
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      $("button[type=submit]", form).textContent = `Uploading ${index + 1} of ${files.length}…`;
      await request("/api/files", {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-Job": encodeURIComponent(job),
          "X-File-Category": encodeURIComponent(type),
          "X-File-Name": encodeURIComponent(file.name)
        },
        body: file
      });
    }
    form.reset();
    $("#masterFileLabel").textContent = "Any file type, up to 20 MB each";
    showToast(`${files.length} file${files.length === 1 ? "" : "s"} added to ${type}.`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(form, false);
  }
});

$("#taskForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submitter = event.submitter;
  const buttons = $$("button[type=submit]", form);
  const data = Object.fromEntries(new FormData(form));
  data.action = submitter?.value || "";
  buttons.forEach((button) => { button.disabled = true; });
  const originalLabel = submitter?.textContent || "";
  if (submitter) submitter.textContent = data.action === "finished" ? "Finishing…" : "Saving…";
  try {
    const result = await request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    form.elements.input.value = "";
    showToast(`${result.task} marked ${result.action === "finished" ? "finished" : "updated"}.`);
    await loadTasks();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
    if (submitter) submitter.textContent = originalLabel;
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
