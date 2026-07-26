import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

type Settings = {
  accessPin: string;
  driveFolderId: string;
  googlePrivateKey: string;
  googleServiceAccountEmail: string;
  spreadsheetId: string;
};

type JsonObject = Record<string, unknown>;
type GoogleTokenResponse = { access_token?: string; error?: string; error_description?: string };

const port = Number(process.env.PORT || 3000);
const rootDir = path.join(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const settingsFilePath = process.env.SETTINGS_FILE_PATH
  ? path.resolve(process.env.SETTINGS_FILE_PATH)
  : path.join(rootDir, "data", "app-settings.json");
const googleTokenUrl = "https://oauth2.googleapis.com/token";
const masterPin = clean(process.env.SITE_MASTER_PIN) || "";
const unlockSecret = clean(process.env.SITE_UNLOCK_SECRET) || crypto.randomBytes(32).toString("hex");
const unlockCookie = "sheet_helper_unlock";
const maxJsonBytes = 2 * 1024 * 1024;
const maxImageBytes = 20 * 1024 * 1024;

export const sheetDefinitions = {
  Jobs: ["Job"],
  Photos: ["Job", "Date", "Photo"],
  Reports: ["Job", "Date", "Report"],
  Receipt: ["Job", "Date", "Photo", "Total", "Line Items"]
} as const;

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function spreadsheetIdFrom(value: unknown): string {
  const input = clean(value);
  const urlMatch = input.match(/\/spreadsheets\/d\/([^/?#]+)/i);
  return urlMatch?.[1] || input;
}

export function driveFolderIdFrom(value: unknown): string {
  const input = clean(value);
  const pathMatch = input.match(/\/folders\/([^/?#]+)/i);
  if (pathMatch?.[1]) return pathMatch[1];
  try {
    const url = new URL(input);
    return clean(url.searchParams.get("id")) || input;
  } catch {
    return input;
  }
}

function defaults(): Settings {
  return {
    accessPin: "",
    driveFolderId: "",
    googlePrivateKey: "",
    googleServiceAccountEmail: "",
    spreadsheetId: ""
  };
}

function sanitizeSettings(input: Partial<Settings>, previous = defaults()): Settings {
  return {
    accessPin: clean(input.accessPin),
    driveFolderId: driveFolderIdFrom(input.driveFolderId),
    googlePrivateKey: clean(input.googlePrivateKey) || previous.googlePrivateKey,
    googleServiceAccountEmail: clean(input.googleServiceAccountEmail),
    spreadsheetId: spreadsheetIdFrom(input.spreadsheetId)
  };
}

function loadSettings(): Settings {
  try {
    return sanitizeSettings(JSON.parse(fs.readFileSync(settingsFilePath, "utf8")));
  } catch {
    return defaults();
  }
}

function saveSettings(input: Partial<Settings>): Settings {
  const saved = sanitizeSettings(input, loadSettings());
  fs.mkdirSync(path.dirname(settingsFilePath), { recursive: true });
  fs.writeFileSync(settingsFilePath, JSON.stringify(saved, null, 2), "utf8");
  return saved;
}

function credentials(settings: Settings) {
  return {
    email: settings.googleServiceAccountEmail || clean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
    key: (settings.googlePrivateKey || clean(process.env.GOOGLE_PRIVATE_KEY)).replace(/\\n/g, "\n")
  };
}

function base64Url(value: string | Buffer | object): string {
  const buffer = Buffer.isBuffer(value)
    ? value
    : Buffer.from(typeof value === "string" ? value : JSON.stringify(value), "utf8");
  return buffer.toString("base64url");
}

function signedJwt(email: string, key: string, scopes: string[]): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url({ alg: "RS256", typ: "JWT" });
  const claims = base64Url({
    aud: googleTokenUrl,
    exp: now + 3600,
    iat: now,
    iss: email,
    scope: scopes.join(" ")
  });
  const unsigned = `${header}.${claims}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).end().sign(key);
  return `${unsigned}.${base64Url(signature)}`;
}

async function googleToken(settings: Settings, scopes: string[]): Promise<string> {
  const { email, key } = credentials(settings);
  if (!email || !key) throw new Error("Google service account credentials are not configured.");
  const response = await fetch(googleTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      assertion: signedJwt(email, key, scopes),
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer"
    })
  });
  const result = await response.json() as GoogleTokenResponse;
  if (!response.ok || !result.access_token) {
    throw new Error(result.error_description || result.error || "Google authentication failed.");
  }
  return result.access_token;
}

async function googleJson<T>(
  url: string,
  token: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const payload = await response.json().catch(() => ({})) as JsonObject;
  if (!response.ok) {
    const googleMessage = (payload.error as { message?: string } | undefined)?.message;
    throw new Error(googleMessage || `Google request failed (${response.status}).`);
  }
  return payload as T;
}

function requireGoogleTargets(settings: Settings): void {
  if (!settings.spreadsheetId) throw new Error("Spreadsheet ID is not configured.");
}

async function ensureWorkbook(settings: Settings, token: string): Promise<void> {
  requireGoogleTargets(settings);
  const id = encodeURIComponent(settings.spreadsheetId);
  const metadata = await googleJson<{ sheets?: Array<{ properties?: { title?: string } }> }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties.title`,
    token
  );
  const existing = new Set((metadata.sheets || []).map((sheet) => sheet.properties?.title || ""));
  const missing = Object.keys(sheetDefinitions).filter((title) => !existing.has(title));
  if (missing.length) {
    await googleJson(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, token, {
      method: "POST",
      body: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) }
    });
  }
  await Promise.all(Object.entries(sheetDefinitions).map(([title, headers]) =>
    googleJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`${title}!A1:${String.fromCharCode(64 + headers.length)}1`)}?valueInputOption=RAW`,
      token,
      { method: "PUT", body: { values: [headers] } }
    )
  ));
}

async function sheetToken(settings: Settings): Promise<string> {
  return googleToken(settings, ["https://www.googleapis.com/auth/spreadsheets"]);
}

async function getJobs(settings: Settings): Promise<string[]> {
  const token = await sheetToken(settings);
  await ensureWorkbook(settings, token);
  const range = encodeURIComponent("Jobs!A2:A");
  const result = await googleJson<{ values?: unknown[][] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(settings.spreadsheetId)}/values/${range}`,
    token
  );
  return [...new Set((result.values || []).map((row) => clean(row[0])).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

async function validateJob(settings: Settings, job: string): Promise<void> {
  const jobs = await getJobs(settings);
  if (!jobs.includes(job)) throw new Error("That job is no longer listed on the Jobs sheet.");
}

async function appendSheetRow(settings: Settings, tab: keyof typeof sheetDefinitions, values: string[]): Promise<void> {
  const token = await sheetToken(settings);
  await ensureWorkbook(settings, token);
  await googleJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(settings.spreadsheetId)}/values/${encodeURIComponent(`${tab}!A:${String.fromCharCode(64 + values.length)}`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    token,
    { method: "POST", body: { values: [values] } }
  );
}

function safeName(value: string): string {
  return value.normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100) || "job";
}

function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.APP_TIMEZONE || "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

export function photoFileName(job: string, date: string, index = 1): string {
  return `${safeName(job)}_${date}${index > 1 ? `_${index}` : ""}.jpg`;
}

export function receiptFileName(job: string, date: string): string {
  return `${safeName(job)}_receipt_${date}.jpg`;
}

async function uploadDriveImage(settings: Settings, file: Buffer, fileName: string): Promise<string> {
  if (!settings.driveFolderId) throw new Error("Google Drive folder ID is not configured.");
  const token = await googleToken(settings, ["https://www.googleapis.com/auth/drive"]);
  const boundary = `sheethelper_${crypto.randomBytes(12).toString("hex")}`;
  const metadata = Buffer.from(JSON.stringify({
    name: fileName,
    parents: [settings.driveFolderId]
  }), "utf8");
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
    metadata,
    Buffer.from(`\r\n--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}--`)
  ]);
  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body
    }
  );
  const result = await response.json() as { id?: string; webViewLink?: string; error?: { message?: string } };
  if (!response.ok || !result.id) throw new Error(result.error?.message || "Drive upload failed.");
  return result.webViewLink || `https://drive.google.com/file/d/${result.id}/view`;
}

async function readReceipt(settings: Settings, image: Buffer): Promise<string> {
  const token = await googleToken(settings, ["https://www.googleapis.com/auth/cloud-platform"]);
  const result = await googleJson<{
    responses?: Array<{ fullTextAnnotation?: { text?: string }; error?: { message?: string } }>
  }>("https://vision.googleapis.com/v1/images:annotate", token, {
    method: "POST",
    body: {
      requests: [{
        image: { content: image.toString("base64") },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }]
      }]
    }
  });
  const response = result.responses?.[0];
  if (response?.error?.message) throw new Error(response.error.message);
  return response?.fullTextAnnotation?.text || "";
}

export function parseReceiptText(text: string): { total: string; lineItems: string } {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const money = /(?:[$€£]\s*)?(\d{1,6}[.,]\d{2})\b/;
  const totalCandidates = lines
    .map((line, index) => ({ line, index, match: line.match(money) }))
    .filter((entry) => entry.match && /\b(grand\s*total|amount\s*due|balance\s*due|total)\b/i.test(entry.line))
    .filter((entry) => !/\b(subtotal|tax total|total tax)\b/i.test(entry.line));
  const chosen = totalCandidates.at(-1);
  const total = chosen?.match ? chosen.match[1].replace(",", ".") : "";
  const excluded = /\b(subtotal|total|tax|change|cash|credit|debit|visa|mastercard|amex|receipt|thank|payment|balance|amount due)\b/i;
  const items = lines
    .filter((line, index) => index !== chosen?.index && money.test(line) && !excluded.test(line))
    .map((line) => line.replace(/\s+([$€£]?\s*\d{1,6}[.,]\d{2})\s*$/, " — $1"))
    .slice(0, 50);
  return { total, lineItems: items.join("\n") };
}

function parseCookies(req: http.IncomingMessage): Record<string, string> {
  return String(req.headers.cookie || "").split(";").reduce<Record<string, string>>((all, item) => {
    const [key, ...parts] = item.trim().split("=");
    if (key) all[key] = parts.join("=");
    return all;
  }, {});
}

type AccessRole = "master" | "user";

function cookieValue(role: AccessRole): string {
  const payload = `${role}:${Date.now()}`;
  return `${base64Url(payload)}.${crypto.createHmac("sha256", unlockSecret).update(payload).digest("hex")}`;
}

function cookieRole(req: http.IncomingMessage): AccessRole | null {
  const [encoded, signature] = (parseCookies(req)[unlockCookie] || "").split(".");
  if (!encoded || !signature) return null;
  try {
    const payload = Buffer.from(encoded, "base64url").toString("utf8");
    const expected = crypto.createHmac("sha256", unlockSecret).update(payload).digest("hex");
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return null;
    }
    const role = payload.split(":")[0];
    return role === "master" || role === "user" ? role : null;
  } catch {
    return null;
  }
}

function hasUserPin(settings: Settings): boolean {
  return /^\d{4}$/.test(settings.accessPin);
}

function hasMasterPin(): boolean {
  return /^\d{4}$/.test(masterPin);
}

function mainIsProtected(settings: Settings): boolean {
  return hasUserPin(settings) || hasMasterPin();
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        reject(new Error("Upload is too large."));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req: http.IncomingMessage): Promise<JsonObject> {
  const raw = await readBody(req, maxJsonBytes);
  try {
    return raw.length ? JSON.parse(raw.toString("utf8")) as JsonObject : {};
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function header(req: http.IncomingMessage, name: string): string {
  const value = req.headers[name.toLowerCase()];
  return clean(Array.isArray(value) ? value[0] : value ? decodeURIComponent(value) : "");
}

function requireJpeg(req: http.IncomingMessage): void {
  if (!String(req.headers["content-type"] || "").startsWith("image/jpeg")) {
    throw new Error("Please upload a JPG image.");
  }
}

async function api(req: http.IncomingMessage, res: http.ServerResponse, route: string): Promise<void> {
  const settings = loadSettings();
  if (route === "/api/status" && req.method === "GET") {
    const { email, key } = credentials(settings);
    sendJson(res, 200, {
      locked: mainIsProtected(settings) && !cookieRole(req),
      pinConfigured: mainIsProtected(settings),
      ready: Boolean(email && key && settings.spreadsheetId && settings.driveFolderId)
    });
    return;
  }
  if (route === "/api/settings/status" && req.method === "GET") {
    sendJson(res, 200, {
      locked: hasMasterPin() && cookieRole(req) !== "master",
      masterPinConfigured: hasMasterPin()
    });
    return;
  }
  if (route === "/api/unlock" && req.method === "POST") {
    const { pin } = await readJson(req);
    const enteredPin = clean(pin);
    const role: AccessRole | null = hasMasterPin() && enteredPin === masterPin
      ? "master"
      : hasUserPin(settings) && enteredPin === settings.accessPin
        ? "user"
        : null;
    if (!role) {
      sendJson(res, 401, { error: "That access code did not match." });
      return;
    }
    res.setHeader("Set-Cookie", `${unlockCookie}=${cookieValue(role)}; Path=/; Max-Age=43200; HttpOnly; SameSite=Strict`);
    sendJson(res, 200, { ok: true, role });
    return;
  }
  if (route === "/api/settings/unlock" && req.method === "POST") {
    const { pin } = await readJson(req);
    if (!hasMasterPin() || clean(pin) !== masterPin) {
      sendJson(res, 401, { error: "Enter the master access code." });
      return;
    }
    res.setHeader("Set-Cookie", `${unlockCookie}=${cookieValue("master")}; Path=/; Max-Age=43200; HttpOnly; SameSite=Strict`);
    sendJson(res, 200, { ok: true, role: "master" });
    return;
  }
  if (route === "/api/config" && hasMasterPin() && cookieRole(req) !== "master") {
    sendJson(res, 401, { error: "The master access code is required.", locked: true });
    return;
  }
  if (mainIsProtected(settings) && !cookieRole(req)) {
    sendJson(res, 401, { error: "Unlock the site first.", locked: true });
    return;
  }
  if (route === "/api/config" && req.method === "GET") {
    const { email, key } = credentials(settings);
    sendJson(res, 200, {
      accessPin: "",
      driveFolderId: settings.driveFolderId,
      googlePrivateKey: "",
      googleServiceAccountEmail: email,
      hasGooglePrivateKey: Boolean(key),
      spreadsheetId: settings.spreadsheetId
    });
    return;
  }
  if (route === "/api/config" && req.method === "POST") {
    const body = await readJson(req) as Partial<Settings>;
    if (clean(body.accessPin) && !/^\d{4}$/.test(clean(body.accessPin))) {
      throw new Error("The access code must be exactly four digits.");
    }
    saveSettings(body);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (route === "/api/jobs" && req.method === "GET") {
    sendJson(res, 200, { jobs: await getJobs(settings) });
    return;
  }
  if (route === "/api/reports" && req.method === "POST") {
    const body = await readJson(req);
    const job = clean(body.job);
    const report = clean(body.report);
    if (!job || !report) throw new Error("Choose a job and enter a report.");
    if (report.length > 10000) throw new Error("Report is too long.");
    await validateJob(settings, job);
    await appendSheetRow(settings, "Reports", [job, today(), report]);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (route === "/api/photos" && req.method === "POST") {
    requireJpeg(req);
    const job = header(req, "x-job");
    const index = Math.max(1, Number.parseInt(header(req, "x-photo-index") || "1", 10) || 1);
    if (!job) throw new Error("Choose a job.");
    const image = await readBody(req, maxImageBytes);
    if (!image.length) throw new Error("The image was empty.");
    await validateJob(settings, job);
    const date = today();
    const link = await uploadDriveImage(settings, image, photoFileName(job, date, index));
    await appendSheetRow(settings, "Photos", [job, date, link]);
    sendJson(res, 200, { ok: true, link });
    return;
  }
  if (route === "/api/receipts" && req.method === "POST") {
    requireJpeg(req);
    const job = header(req, "x-job");
    if (!job) throw new Error("Choose a job.");
    const image = await readBody(req, maxImageBytes);
    if (!image.length) throw new Error("The image was empty.");
    await validateJob(settings, job);
    const date = today();
    const [link, receiptText] = await Promise.all([
      uploadDriveImage(settings, image, receiptFileName(job, date)),
      readReceipt(settings, image)
    ]);
    const parsed = parseReceiptText(receiptText);
    await appendSheetRow(settings, "Receipt", [job, date, link, parsed.total, parsed.lineItems]);
    sendJson(res, 200, { ok: true, link, ...parsed });
    return;
  }
  sendJson(res, 404, { error: "Not found." });
}

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml"
};

function serveStatic(route: string, res: http.ServerResponse): void {
  const requested = route === "/"
    ? "index.html"
    : route === "/settings"
      ? "settings.html"
      : route.replace(/^\/+/, "");
  const resolved = path.resolve(publicDir, requested);
  if (!resolved.startsWith(path.resolve(publicDir))) {
    sendJson(res, 404, { error: "Not found." });
    return;
  }
  fs.readFile(resolved, (error, contents) => {
    if (error) {
      if (path.extname(route)) {
        sendJson(res, 404, { error: "Not found." });
      } else {
        serveStatic("/", res);
      }
      return;
    }
    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(resolved)] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(contents);
  });
}

if (require.main === module) {
  http.createServer((req, res) => {
    const route = decodeURIComponent((req.url || "/").split("?")[0]);
    if (route.startsWith("/api/")) {
      void api(req, res, route).catch((error: unknown) => {
        sendJson(res, 500, { error: error instanceof Error ? error.message : "Unexpected error." });
      });
    } else {
      serveStatic(route, res);
    }
  }).listen(port, () => console.log(`SheetHelper running on http://localhost:${port}`));
}
