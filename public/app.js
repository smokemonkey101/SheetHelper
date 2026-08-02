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
    const options = ['<option value="">No specific task</option>', ...tasks.map((task) => {
      const option = document.createElement("option");
      option.value = task.id;
      option.textContent = task.text;
      return option.outerHTML;
    })].join("");
    select.innerHTML = options;
    select.disabled = false;
    if (!tasks.length) showToast(`No tasks are listed for ${job}. You can still submit a Task Report.`);
  } catch (error) {
    select.innerHTML = '<option value="">Tasks unavailable</option>';
    showToast(error.message, true);
  }
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

$("#taskJob").addEventListener("change", loadTasks);

$("#photoForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const job = new FormData(form).get("job");
  const files = [...$("#photoFiles").files];
  if (!files.length) return showToast("Choose at least one file.", true);
  setBusy(form, true, `Uploading 1 of ${files.length}…`);
  let uploadedCount = 0;
  const failures = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    try {
      $("button[type=submit]", form).textContent = `Uploading ${index + 1} of ${files.length}…`;
      await request("/api/photos", {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-Job": encodeURIComponent(job),
          "X-Photo-Index": String(index + 1),
          "X-File-Name": encodeURIComponent(file.name)
        },
        body: file
      });
      uploadedCount += 1;
    } catch (error) {
      failures.push({ name: file.name, message: error.message });
    }
  }
  if (uploadedCount) {
    form.reset();
    $("#photoFileLabel").textContent = "Images, PDFs, and other files";
  }
  if (failures.length) {
    const firstFailure = failures[0];
    showToast(
      `${uploadedCount} of ${files.length} files uploaded. ${failures.length} failed. ` +
      `${firstFailure.name}: ${firstFailure.message}`,
      true
    );
  } else {
    showToast(`${uploadedCount} file${uploadedCount === 1 ? "" : "s"} added to ${job}.`);
  }
  setBusy(form, false);
});

$("#receiptForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const job = new FormData(form).get("job");
  const file = $("#receiptFile").files[0];
  if (!file) return showToast("Choose one receipt photo.", true);
  setBusy(form, true, "Reading receipt…");
  try {
    const result = await request("/api/receipts", {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-Job": encodeURIComponent(job),
        "X-File-Name": encodeURIComponent(file.name)
      },
      body: file
    });
    form.reset();
    $("#receiptFileLabel").textContent = "Make sure the total is clearly visible";
    showToast(result.ocrSkipped
      ? `Receipt file added to ${job}. Automatic reading requires a JPG, PNG, GIF, or WebP image.`
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
  const tag = data.get("tag");
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
          "X-File-Name": encodeURIComponent(file.name),
          "X-File-Tag": encodeURIComponent(tag)
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
    const subject = result.task || "Task report";
    showToast(`${subject} marked ${result.action === "finished" ? "finished" : "updated"}.`);
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
