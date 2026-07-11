import http from "node:http";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeSnapshot } from "./analyzer.js";
import { generateReviewFilter } from "./filter-generator.js";
import {
  dataDir,
  ensureStorage,
  getConfig,
  getLanAddresses,
  listSnapshots,
  readGeneratedFilter,
  readSnapshot,
  saveSnapshot,
  writeAnalysis,
  writeGeneratedFilter,
} from "./storage.js";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(__dirname, "../static");
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
const maxBodyBytes = Number(process.env.LE_COMPANION_MAX_BODY_BYTES ?? 128 * 1024 * 1024);
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? "";
const pairingsPath = path.join(dataDir, "device-pairings.json");
const devicesPath = path.join(dataDir, "devices.json");

await ensureStorage();
const config = await getConfig();

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    sendJson(res, 500, {
      error: "internal_error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, host, async () => {
  const lanUrls = await getLanAddresses(port);
  await writeDeckySettingsFile(lanUrls);
  console.log("");
  console.log("Last Epoch Deck Companion server is running.");
  console.log(`Local UI: http://127.0.0.1:${port}`);
  for (const url of lanUrls) console.log(`LAN UI:   ${url}`);
  console.log(`Pairing token: ${config.pairingToken}`);
  console.log(`Data dir: ${dataDir}`);
  console.log("");
});

async function writeDeckySettingsFile(lanUrls) {
  const downloadsDir = path.join(staticDir, "downloads");
  await fs.mkdir(downloadsDir, { recursive: true });
  const preferredUrl = publicBaseUrl || chooseDeckUrl(lanUrls) || `http://127.0.0.1:${port}`;
  const exposeSetupToken = process.env.LE_COMPANION_EXPOSE_SETUP_TOKEN === "1" || !publicBaseUrl;
  const settings = {
    serverUrl: preferredUrl,
    pairingToken: exposeSetupToken ? config.pairingToken : "",
    savesRoot: "/home/deck/.config/unity3d/Eleventh Hour Games/Last Epoch/Saves",
    filtersRoot: "/home/deck/.config/unity3d/Eleventh Hour Games/Last Epoch/Filters",
    generatedAt: new Date().toISOString(),
    availableServerUrls: lanUrls,
  };
  await fs.writeFile(
    path.join(downloadsDir, "last-epoch-companion-settings.json"),
    `${JSON.stringify(settings, null, 2)}\n`,
    "utf8",
  );
}

function chooseDeckUrl(lanUrls) {
  return (
    lanUrls.find((url) => url.includes("://192.168.")) ??
    lanUrls.find((url) => url.includes("://172.")) ??
    lanUrls.find((url) => url.includes("://10.")) ??
    lanUrls[0]
  );
}

async function route(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const method = req.method ?? "GET";

  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, await healthPayload());
    return;
  }

  if (method === "GET" && url.pathname === "/api/v1/health") {
    sendJson(res, 200, { ...(await healthPayload()), apiVersion: "v1" });
    return;
  }

  if (method === "POST" && url.pathname === "/api/v1/companion/snapshots") {
    if (!hasToken(req)) return unauthorized(res);
    const body = await readJsonBody(req);
    const result = await importSnapshot({
      ...body,
      source: {
        ...(isObject(body.source) ? body.source : {}),
        kind: "companion",
        companion: body.source?.companion ?? "decky-plugin",
        transport: "http-json",
        apiVersion: "v1",
      },
    });
    sendJson(res, 201, result);
    return;
  }

  if (method === "POST" && url.pathname === "/api/v1/imports/decky-snapshot") {
    if (!hasToken(req)) return unauthorized(res);
    const body = await readJsonBody(req);
    const result = await importSnapshot({
      ...body,
      source: {
        ...(isObject(body.source) ? body.source : {}),
        kind: "companion",
        companion: "decky-plugin",
        transport: "http-json",
        apiVersion: "v1",
      },
    });
    sendJson(res, 201, result);
    return;
  }

  if (method === "GET" && url.pathname === "/api/v1/snapshots") {
    if (!hasAccess(req)) return unauthorized(res);
    sendJson(res, 200, { snapshots: await listSnapshots(), apiVersion: "v1" });
    return;
  }

  if (method === "GET" && url.pathname === "/api/pairing") {
    if (!isLoopback(req.socket.remoteAddress)) {
      sendJson(res, 403, { error: "forbidden", message: "Pairing token is only shown to localhost." });
      return;
    }
    sendJson(res, 200, { pairingToken: config.pairingToken });
    return;
  }

  if (method === "GET" && url.pathname === "/api/snapshots") {
    if (!hasAccess(req)) return unauthorized(res);
    sendJson(res, 200, { snapshots: await listSnapshots() });
    return;
  }

  if (method === "GET" && url.pathname === "/api/device-pairings") {
    if (!hasAccess(req)) return unauthorized(res);
    sendJson(res, 200, { pairings: await listDevicePairings() });
    return;
  }

  if (method === "POST" && url.pathname === "/api/device-pairings") {
    const body = await readJsonBody(req);
    const pairing = await createDevicePairing(body);
    sendJson(res, 201, { pairing });
    return;
  }

  const devicePairingMatch = url.pathname.match(/^\/api\/device-pairings\/([a-zA-Z0-9_-]+)$/);
  if (method === "GET" && devicePairingMatch) {
    const pairing = await getDevicePairing(devicePairingMatch[1]);
    if (!pairing) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    const response = publicPairingView(pairing);
    sendJson(res, 200, { pairing: response });
    return;
  }

  const approvePairingMatch = url.pathname.match(/^\/api\/device-pairings\/([a-zA-Z0-9_-]+)\/approve$/);
  if (method === "POST" && approvePairingMatch) {
    if (!hasAccess(req)) return unauthorized(res);
    const pairing = await approveDevicePairing(approvePairingMatch[1]);
    if (!pairing) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    sendJson(res, 200, { pairing: adminPairingView(pairing) });
    return;
  }

  if (method === "POST" && url.pathname === "/api/snapshots") {
    if (!hasToken(req)) return unauthorized(res);
    const body = await readJsonBody(req);
    sendJson(res, 201, await importSnapshot(body));
    return;
  }

  const snapshotMatch = url.pathname.match(/^\/api\/snapshots\/([a-zA-Z0-9_-]+)$/);
  if (method === "GET" && snapshotMatch) {
    if (!hasAccess(req)) return unauthorized(res);
    const snapshot = await readSnapshot(snapshotMatch[1]);
    sendJson(res, 200, { snapshot: snapshot.manifest, analysis: snapshot.analysis });
    return;
  }

  const analyzeMatch = url.pathname.match(/^\/api\/snapshots\/([a-zA-Z0-9_-]+)\/analyze$/);
  if (method === "POST" && analyzeMatch) {
    if (!hasAccess(req)) return unauthorized(res);
    const { manifest, rawDir } = await readSnapshot(analyzeMatch[1]);
    const analysis = await analyzeSnapshot(manifest, rawDir);
    await writeAnalysis(manifest.id, analysis);
    sendJson(res, 200, { analysis });
    return;
  }

  const filterMatch = url.pathname.match(/^\/api\/snapshots\/([a-zA-Z0-9_-]+)\/review-filter$/);
  if (method === "POST" && filterMatch) {
    if (!hasAccess(req)) return unauthorized(res);
    const id = filterMatch[1];
    const fileName = `DeckCompanion_${id}.xml`;
    const xml = generateReviewFilter({ snapshotId: id });
    await writeGeneratedFilter(id, fileName, xml);
    sendJson(res, 200, { fileName, xml });
    return;
  }

  const generatedFilterMatch = url.pathname.match(/^\/api\/snapshots\/([a-zA-Z0-9_-]+)\/review-filter\/([^/]+)$/);
  if (method === "GET" && generatedFilterMatch) {
    if (!hasAccess(req)) return unauthorized(res);
    const xml = await readGeneratedFilter(generatedFilterMatch[1], decodeURIComponent(generatedFilterMatch[2]));
    sendText(res, 200, xml, "application/xml; charset=utf-8");
    return;
  }

  if (method === "GET") {
    await serveStatic(url.pathname, res);
    return;
  }

  sendJson(res, 404, { error: "not_found" });
}

async function healthPayload() {
  return {
    ok: true,
    port,
    publicBaseUrl,
    lanUrls: await getLanAddresses(port),
    dataDir,
  };
}

async function importSnapshot(body) {
  const manifest = await saveSnapshot(body);
  const { rawDir } = await readSnapshot(manifest.id);
  const analysis = await analyzeSnapshot(manifest, rawDir);
  await writeAnalysis(manifest.id, analysis);
  return { snapshot: manifest, analysis };
}

async function serveStatic(requestPath, res) {
  const cleanPath = requestPath === "/" ? "/index.html" : requestPath;
  const target = path.resolve(staticDir, `.${cleanPath}`);
  if (!target.startsWith(staticDir)) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }
  try {
    const data = await fs.readFile(target);
    sendBuffer(res, 200, data, contentType(target));
  } catch {
    sendJson(res, 404, { error: "not_found" });
  }
}

function hasAccess(req) {
  return isLoopback(req.socket.remoteAddress) || hasToken(req);
}

function hasToken(req) {
  const token = req.headers["x-pairing-token"] ?? req.headers["x-device-token"];
  return token === config.pairingToken || isKnownDeviceToken(token);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unauthorized(res) {
  sendJson(res, 401, {
    error: "unauthorized",
    message: "Use the pairing token printed by the server.",
  });
}

function isLoopback(address = "") {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      throw new Error(`Request body too large. Limit is ${maxBodyBytes} bytes.`);
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function sendJson(res, status, data) {
  sendText(res, status, `${JSON.stringify(data, null, 2)}\n`, "application/json; charset=utf-8");
}

function sendText(res, status, text, type) {
  const body = Buffer.from(text, "utf8");
  sendBuffer(res, status, body, type);
}

function sendBuffer(res, status, body, type) {
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

async function createDevicePairing(body) {
  const pairings = await readJsonArray(pairingsPath);
  const now = new Date();
  const pairing = {
    id: crypto.randomBytes(16).toString("base64url"),
    code: crypto.randomBytes(3).toString("hex").toUpperCase(),
    status: "pending",
    deckName: String(body.deckName ?? "Steam Deck"),
    pluginVersion: String(body.pluginVersion ?? "unknown"),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    approvedAt: null,
    deviceToken: null,
  };
  pairings.push(pairing);
  await writeJsonFile(pairingsPath, prunePairings(pairings));
  return publicPairingView(pairing);
}

async function listDevicePairings() {
  const pairings = prunePairings(await readJsonArray(pairingsPath));
  await writeJsonFile(pairingsPath, pairings);
  return pairings.map(adminPairingView).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function getDevicePairing(id) {
  const pairings = prunePairings(await readJsonArray(pairingsPath));
  await writeJsonFile(pairingsPath, pairings);
  return pairings.find((pairing) => pairing.id === id) ?? null;
}

async function approveDevicePairing(id) {
  const pairings = prunePairings(await readJsonArray(pairingsPath));
  const pairing = pairings.find((item) => item.id === id);
  if (!pairing) return null;
  if (pairing.status !== "approved") {
    pairing.status = "approved";
    pairing.approvedAt = new Date().toISOString();
    pairing.deviceToken = crypto.randomBytes(24).toString("base64url");
    const devices = await readJsonArray(devicesPath);
    devices.push({
      id: pairing.id,
      deckName: pairing.deckName,
      pluginVersion: pairing.pluginVersion,
      token: pairing.deviceToken,
      createdAt: pairing.createdAt,
      approvedAt: pairing.approvedAt,
    });
    await writeJsonFile(devicesPath, devices);
  }
  await writeJsonFile(pairingsPath, pairings);
  return pairing;
}

function publicPairingView(pairing) {
  return {
    id: pairing.id,
    code: pairing.code,
    status: pairing.status,
    deckName: pairing.deckName,
    createdAt: pairing.createdAt,
    expiresAt: pairing.expiresAt,
    deviceToken: pairing.status === "approved" ? pairing.deviceToken : null,
  };
}

function adminPairingView(pairing) {
  return {
    id: pairing.id,
    code: pairing.code,
    status: pairing.status,
    deckName: pairing.deckName,
    pluginVersion: pairing.pluginVersion,
    createdAt: pairing.createdAt,
    expiresAt: pairing.expiresAt,
    approvedAt: pairing.approvedAt,
  };
}

function prunePairings(pairings) {
  const now = Date.now();
  return pairings
    .filter((pairing) => pairing.status === "approved" || new Date(pairing.expiresAt).getTime() > now)
    .slice(-100);
}

function isKnownDeviceToken(token) {
  if (!token || typeof token !== "string") return false;
  try {
    const devices = JSON.parse(fsSync.readFileSync(devicesPath, "utf8"));
    return devices.some((device) => device.token === token);
  } catch {
    return false;
  }
}

async function readJsonArray(filePath) {
  try {
    const value = JSON.parse(await fs.readFile(filePath, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
