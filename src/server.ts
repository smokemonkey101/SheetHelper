import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

type Settings = {
  accessPin: string;
  driveFolderId: string;
  googleDriveRefreshToken: string;
  googleOAuthClientId: string;
  googleOAuthClientSecret: string;
  googlePrivateKey: string;
  googleServiceAccountEmail: string;
  spreadsheetId: string;
  user1Name: string;
  user1Pin: string;
  user2Name: string;
  user2Pin: string;
  user3Name: string;
  user3Pin: string;
};

type JsonObject = Record<string, unknown>;
type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
  refresh_token?: string;
};

const port = Number(process.env.PORT || 3000);
const rootDir = path.join(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const settingsFilePath = process.env.SETTINGS_FILE_PATH
  ? path.resolve(process.env.SETTINGS_FILE_PATH)
  : path.join(rootDir, "data", "app-settings.json");
const googleTokenUrl = "https://oauth2.googleapis.com/token";
const googleAuthorizationUrl = "https://accounts.google.com/o/oauth2/v2/auth";
const masterPin = clean(process.env.SITE_MASTER_PIN) || "";
const unlockSecret = clean(process.env.SITE_UNLOCK_SECRET) || crypto.randomBytes(32).toString("hex");
const unlockCookie = "sheet_helper_unlock";
const oauthStateCookie = "sheet_helper_drive_oauth";
const maxJsonBytes = 2 * 1024 * 1024;
const maxImageBytes = 20 * 1024 * 1024;

export const sheetDefinitions = {
  Jobs: ["Job"],
  Photos: ["Job", "Person", "Date", "Photo"],
  Reports: ["Job", "Person", "Date", "Report"],
  Receipt: ["Job", "Person", "Date", "Photo", "Total", "Line Items"]
} as const;

const previousSheetDefinitions = {
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
    googleDriveRefreshToken: "",
    googleOAuthClientId: "",
    googleOAuthClientSecret: "",
    googlePrivateKey: "",
    googleServiceAccountEmail: "",
    spreadsheetId: "",
    user1Name: "",
    user1Pin: "",
    user2Name: "",
    user2Pin: "",
    user3Name: "",
    user3Pin: ""
  };
}

function sanitizeSettings(input: Partial<Settings>, previous = defaults()): Settings {
  const legacyPin = clean(input.accessPin);
  const migratingLegacyPin = legacyPin && !clean(input.user1Pin) && !clean(previous.user1Pin);
  return {
    accessPin: "",
    driveFolderId: driveFolderIdFrom(input.driveFolderId),
    googleDriveRefreshToken: clean(input.googleDriveRefreshToken) || previous.googleDriveRefreshToken,
    googleOAuthClientId: clean(input.googleOAuthClientId),
    googleOAuthClientSecret: clean(input.googleOAuthClientSecret) || previous.googleOAuthClientSecret,
    googlePrivateKey: clean(input.googlePrivateKey) || previous.googlePrivateKey,
    googleServiceAccountEmail: clean(input.googleServiceAccountEmail),
    spreadsheetId: spreadsheetIdFrom(input.spreadsheetId),
    user1Name: clean(input.user1Name) || (migratingLegacyPin ? "User 1" : ""),
    user1Pin: clean(input.user1Pin) || (migratingLegacyPin ? legacyPin : ""),
    user2Name: clean(input.user2Name),
    user2Pin: clean(input.user2Pin),
    user3Name: clean(input.user3Name),
    user3Pin: clean(input.user3Pin)
  };
}

function loadSettings(): Settings {
  try {
    return sanitizeSettings(JSON.parse(fs.readFileSync(settingsFilePath, "utf8")));
  } catch {
    return defaults();
  }
}

function persistSettings(settings: Settings): Settings {
  fs.mkdirSync(path.dirname(settingsFilePath), { recursive: true });
  fs.writeFileSync(settingsFilePath, JSON.stringify(settings, null, 2), "utf8");
  return settings;
}

function saveSettings(input: Partial<Settings>): Settings {
  const current = loadSettings();
  return persistSettings(sanitizeSettings({ ...current, ...input }, current));
}

function clearDriveOAuthSettings(): Settings {
  const current = loadSettings();
  return persistSettings({
    ...current,
    driveFolderId: "",
    googleDriveRefreshToken: ""
  });
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

function oauthCredentials(settings: Settings) {
  return {
    clientId: settings.googleOAuthClientId || clean(process.env.GOOGLE_OAUTH_CLIENT_ID),
    clientSecret: settings.googleOAuthClientSecret || clean(process.env.GOOGLE_OAUTH_CLIENT_SECRET),
    refreshToken: settings.googleDriveRefreshToken || clean(process.env.GOOGLE_DRIVE_REFRESH_TOKEN)
  };
}

function requestOrigin(req: http.IncomingMessage): string {
  const configured = clean(process.env.PUBLIC_URL).replace(/\/+$/, "");
  if (configured) return configured;
  const forwardedProto = clean(req.headers["x-forwarded-proto"]?.toString()).split(",")[0];
  const protocol = forwardedProto || "http";
  const host = clean(req.headers.host);
  if (!host) throw new Error("Unable to determine this site's public address.");
  return `${protocol}://${host}`;
}

function oauthRedirectUri(req: http.IncomingMessage): string {
  return clean(process.env.GOOGLE_OAUTH_REDIRECT_URI) ||
    `${requestOrigin(req)}/api/google-drive/oauth/callback`;
}

async function driveOAuthAccessToken(settings: Settings): Promise<string> {
  const { clientId, clientSecret, refreshToken } = oauthCredentials(settings);
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Connect your personal Google Drive from Settings first.");
  }
  const response = await fetch(googleTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });
  const result = await response.json() as GoogleTokenResponse;
  if (!response.ok || !result.access_token) {
    throw new Error(result.error_description || result.error || "Google Drive connection expired.");
  }
  return result.access_token;
}

async function driveAccessToken(settings: Settings): Promise<string> {
  return oauthCredentials(settings).refreshToken
    ? driveOAuthAccessToken(settings)
    : googleToken(settings, ["https://www.googleapis.com/auth/drive"]);
}

async function createPersonalDriveFolder(accessToken: string): Promise<{ id: string; webViewLink: string }> {
  const result = await googleJson<{ id?: string; webViewLink?: string }>(
    "https://www.googleapis.com/drive/v3/files?fields=id,webViewLink",
    accessToken,
    {
      method: "POST",
      body: {
        mimeType: "application/vnd.google-apps.folder",
        name: "SheetHelper Uploads"
      }
    }
  );
  if (!result.id) throw new Error("Google Drive did not return the new folder ID.");
  return {
    id: result.id,
    webViewLink: result.webViewLink || `https://drive.google.com/drive/folders/${result.id}`
  };
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
  const metadata = await googleJson<{ sheets?: Array<{ properties?: { sheetId?: number; title?: string } }> }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties(sheetId,title)`,
    token
  );
  const sheetIds = new Map((metadata.sheets || []).map((sheet) => [
    sheet.properties?.title || "",
    sheet.properties?.sheetId
  ]));
  const existing = new Set(sheetIds.keys());
  const missing = Object.keys(sheetDefinitions).filter((title) => !existing.has(title));
  if (missing.length) {
    await googleJson(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, token, {
      method: "POST",
      body: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) }
    });
  }
  for (const [title, oldHeaders] of Object.entries(previousSheetDefinitions)) {
    const sheetId = sheetIds.get(title);
    if (sheetId === undefined) continue;
    const current = await googleJson<{ values?: unknown[][] }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`${title}!1:1`)}`,
      token
    );
    const header = (current.values?.[0] || []).map(clean);
    if (header.length === oldHeaders.length && oldHeaders.every((value, index) => header[index] === value)) {
      await googleJson(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, token, {
        method: "POST",
        body: {
          requests: [{
            insertDimension: {
              range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 },
              inheritFromBefore: true
            }
          }]
        }
      });
    }
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
  const token = await driveAccessToken(settings);
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
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink",
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
  if (!response.ok || !result.id) {
    const message = result.error?.message || "Drive upload failed.";
    if (/service accounts? do not have storage quota/i.test(message)) {
      throw new Error(
        "Connect your personal Google Drive from Settings. " +
        "Service accounts cannot upload files to a personal My Drive folder."
      );
    }
    throw new Error(message);
  }
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
type AccessIdentity = { role: AccessRole; name: string };

function cookieValue(identity: AccessIdentity): string {
  const payload = JSON.stringify({ ...identity, issuedAt: Date.now() });
  return `${base64Url(payload)}.${crypto.createHmac("sha256", unlockSecret).update(payload).digest("hex")}`;
}

function cookieIdentity(req: http.IncomingMessage): AccessIdentity | null {
  const [encoded, signature] = (parseCookies(req)[unlockCookie] || "").split(".");
  if (!encoded || !signature) return null;
  try {
    const payload = Buffer.from(encoded, "base64url").toString("utf8");
    const expected = crypto.createHmac("sha256", unlockSecret).update(payload).digest("hex");
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return null;
    }
    const parsed = JSON.parse(payload) as Partial<AccessIdentity>;
    return (parsed.role === "master" || parsed.role === "user") && clean(parsed.name)
      ? { role: parsed.role, name: clean(parsed.name) }
      : null;
  } catch {
    return null;
  }
}

function configuredUsers(settings: Settings): Array<{ name: string; pin: string }> {
  return [1, 2, 3].map((number) => ({
    name: clean(settings[`user${number}Name` as keyof Settings]),
    pin: clean(settings[`user${number}Pin` as keyof Settings])
  })).filter((user) => user.name && /^\d{4}$/.test(user.pin));
}

function hasUserPin(settings: Settings): boolean {
  return configuredUsers(settings).length > 0;
}

function hasMasterPin(): boolean {
  return /^\d{4}$/.test(masterPin);
}

function mainIsProtected(settings: Settings): boolean {
  return hasUserPin(settings) || hasMasterPin();
}

function actorName(req: http.IncomingMessage): string {
  return cookieIdentity(req)?.name || "Unknown";
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function sendRedirect(res: http.ServerResponse, location: string): void {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

function signedOAuthState(): string {
  const state = crypto.randomBytes(24).toString("base64url");
  const signature = crypto.createHmac("sha256", unlockSecret).update(state).digest("hex");
  return `${state}.${signature}`;
}

function validOAuthState(req: http.IncomingMessage, providedState: string): boolean {
  const saved = parseCookies(req)[oauthStateCookie] || "";
  const [state, signature] = saved.split(".");
  if (!state || !signature || state !== providedState) return false;
  const expected = crypto.createHmac("sha256", unlockSecret).update(state).digest("hex");
  return signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function driveOAuthResultRedirect(req: http.IncomingMessage, result: "connected" | "disconnected" | "error", message = ""): string {
  const url = new URL("/settings", requestOrigin(req));
  url.searchParams.set("drive", result);
  if (message) url.searchParams.set("message", message.slice(0, 300));
  return url.toString();
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
    const identity = cookieIdentity(req);
    sendJson(res, 200, {
      locked: mainIsProtected(settings) && !identity,
      pinConfigured: mainIsProtected(settings),
      person: identity?.name || "",
      ready: Boolean(
        email &&
        key &&
        settings.spreadsheetId &&
        settings.driveFolderId &&
        oauthCredentials(settings).refreshToken
      )
    });
    return;
  }
  if (route === "/api/settings/status" && req.method === "GET") {
    sendJson(res, 200, {
      locked: hasMasterPin() && cookieIdentity(req)?.role !== "master",
      masterPinConfigured: hasMasterPin()
    });
    return;
  }
  if (route === "/api/unlock" && req.method === "POST") {
    const { pin } = await readJson(req);
    const enteredPin = clean(pin);
    const matchedUser = configuredUsers(settings).find((user) => user.pin === enteredPin);
    const identity: AccessIdentity | null = hasMasterPin() && enteredPin === masterPin
      ? { role: "master", name: "Master" }
      : matchedUser
        ? { role: "user", name: matchedUser.name }
        : null;
    if (!identity) {
      sendJson(res, 401, { error: "That access code did not match." });
      return;
    }
    res.setHeader("Set-Cookie", `${unlockCookie}=${cookieValue(identity)}; Path=/; Max-Age=43200; HttpOnly; SameSite=Lax`);
    sendJson(res, 200, { ok: true, role: identity.role, person: identity.name });
    return;
  }
  if (route === "/api/settings/unlock" && req.method === "POST") {
    const { pin } = await readJson(req);
    if (!hasMasterPin() || clean(pin) !== masterPin) {
      sendJson(res, 401, { error: "Enter the master access code." });
      return;
    }
    res.setHeader("Set-Cookie", `${unlockCookie}=${cookieValue({ role: "master", name: "Master" })}; Path=/; Max-Age=43200; HttpOnly; SameSite=Lax`);
    sendJson(res, 200, { ok: true, role: "master" });
    return;
  }
  const masterOnlyRoutes = new Set([
    "/api/config",
    "/api/google-drive/oauth/start",
    "/api/google-drive/oauth/callback",
    "/api/google-drive/oauth/disconnect"
  ]);
  if (masterOnlyRoutes.has(route) && hasMasterPin() && cookieIdentity(req)?.role !== "master") {
    sendJson(res, 401, { error: "The master access code is required.", locked: true });
    return;
  }
  if (mainIsProtected(settings) && !cookieIdentity(req)) {
    sendJson(res, 401, { error: "Unlock the site first.", locked: true });
    return;
  }
  if (route === "/api/config" && req.method === "GET") {
    const { email, key } = credentials(settings);
    sendJson(res, 200, {
      accessPin: "",
      driveFolderId: settings.driveFolderId,
      driveOAuthConnected: Boolean(oauthCredentials(settings).refreshToken),
      googleOAuthClientId: oauthCredentials(settings).clientId,
      googleOAuthClientSecret: "",
      googleOAuthRedirectUri: oauthRedirectUri(req),
      hasGoogleOAuthClientSecret: Boolean(oauthCredentials(settings).clientSecret),
      googlePrivateKey: "",
      googleServiceAccountEmail: email,
      hasGooglePrivateKey: Boolean(key),
      spreadsheetId: settings.spreadsheetId,
      user1Name: settings.user1Name,
      user1Pin: settings.user1Pin,
      user2Name: settings.user2Name,
      user2Pin: settings.user2Pin,
      user3Name: settings.user3Name,
      user3Pin: settings.user3Pin
    });
    return;
  }
  if (route === "/api/config" && req.method === "POST") {
    const body = await readJson(req) as Partial<Settings>;
    const users = [1, 2, 3].map((number) => ({
      name: clean(body[`user${number}Name` as keyof Settings]),
      pin: clean(body[`user${number}Pin` as keyof Settings])
    }));
    for (const user of users) {
      if (Boolean(user.name) !== Boolean(user.pin)) {
        throw new Error("Each person needs both a name and a 4-digit code.");
      }
      if (user.pin && !/^\d{4}$/.test(user.pin)) {
        throw new Error("Each person code must be exactly four digits.");
      }
      if (user.name.length > 80) throw new Error("Person names must be 80 characters or fewer.");
    }
    const pins = users.map((user) => user.pin).filter(Boolean);
    if (new Set(pins).size !== pins.length) throw new Error("Each person must have a different code.");
    if (hasMasterPin() && pins.includes(masterPin)) {
      throw new Error("A person code cannot match the master code.");
    }
    saveSettings(body);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (route === "/api/google-drive/oauth/start" && req.method === "GET") {
    const { clientId, clientSecret } = oauthCredentials(settings);
    if (!clientId || !clientSecret) {
      throw new Error("Save the Google OAuth client ID and client secret before connecting Drive.");
    }
    const signedState = signedOAuthState();
    const state = signedState.split(".")[0];
    const authorizationUrl = new URL(googleAuthorizationUrl);
    authorizationUrl.search = new URLSearchParams({
      access_type: "offline",
      client_id: clientId,
      include_granted_scopes: "true",
      prompt: "consent",
      redirect_uri: oauthRedirectUri(req),
      response_type: "code",
      scope: "https://www.googleapis.com/auth/drive.file",
      state
    }).toString();
    res.setHeader(
      "Set-Cookie",
      `${oauthStateCookie}=${signedState}; Path=/api/google-drive/oauth/callback; Max-Age=600; HttpOnly; SameSite=Lax`
    );
    sendRedirect(res, authorizationUrl.toString());
    return;
  }
  if (route === "/api/google-drive/oauth/callback" && req.method === "GET") {
    const callbackUrl = new URL(req.url || route, requestOrigin(req));
    const state = clean(callbackUrl.searchParams.get("state"));
    const code = clean(callbackUrl.searchParams.get("code"));
    const providerError = clean(callbackUrl.searchParams.get("error"));
    if (providerError) {
      sendRedirect(res, driveOAuthResultRedirect(req, "error", providerError));
      return;
    }
    if (!state || !validOAuthState(req, state)) {
      sendRedirect(res, driveOAuthResultRedirect(req, "error", "The Google connection request expired. Please try again."));
      return;
    }
    if (!code) {
      sendRedirect(res, driveOAuthResultRedirect(req, "error", "Google did not return an authorization code."));
      return;
    }
    try {
      const { clientId, clientSecret } = oauthCredentials(settings);
      const tokenResponse = await fetch(googleTokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: oauthRedirectUri(req)
        })
      });
      const tokenResult = await tokenResponse.json() as GoogleTokenResponse;
      if (!tokenResponse.ok || !tokenResult.access_token || !tokenResult.refresh_token) {
        throw new Error(tokenResult.error_description || tokenResult.error || "Google did not return a reusable Drive connection.");
      }
      const folder = await createPersonalDriveFolder(tokenResult.access_token);
      saveSettings({
        driveFolderId: folder.id,
        googleDriveRefreshToken: tokenResult.refresh_token
      });
      res.setHeader(
        "Set-Cookie",
        `${oauthStateCookie}=; Path=/api/google-drive/oauth/callback; Max-Age=0; HttpOnly; SameSite=Lax`
      );
      sendRedirect(res, driveOAuthResultRedirect(req, "connected"));
    } catch (error) {
      sendRedirect(
        res,
        driveOAuthResultRedirect(req, "error", error instanceof Error ? error.message : "Google Drive connection failed.")
      );
    }
    return;
  }
  if (route === "/api/google-drive/oauth/disconnect" && req.method === "POST") {
    const refreshToken = oauthCredentials(settings).refreshToken;
    if (refreshToken) {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refreshToken })
      }).catch(() => undefined);
    }
    clearDriveOAuthSettings();
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
    await appendSheetRow(settings, "Reports", [job, actorName(req), today(), report]);
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
    await appendSheetRow(settings, "Photos", [job, actorName(req), date, link]);
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
    await appendSheetRow(settings, "Receipt", [job, actorName(req), date, link, parsed.total, parsed.lineItems]);
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
