import crypto from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const defaultDataDir = path.join(projectRoot, "server", "data");
export const dataDir = path.resolve(process.env.LE_COMPANION_DATA_DIR ?? defaultDataDir);
export const snapshotsDir = path.join(dataDir, "snapshots");
export const generatedDir = path.join(dataDir, "generated");
const configPath = path.join(dataDir, "config.json");

export async function ensureStorage() {
  await fs.mkdir(snapshotsDir, { recursive: true });
  await fs.mkdir(generatedDir, { recursive: true });
  if (!existsSync(configPath)) {
    await writeJson(configPath, {
      pairingToken: crypto.randomBytes(18).toString("base64url"),
      createdAt: new Date().toISOString(),
    });
  }
}

export async function getConfig() {
  await ensureStorage();
  const config = await readJson(configPath);
  if (process.env.LE_COMPANION_PAIRING_TOKEN) {
    return {
      ...config,
      pairingToken: process.env.LE_COMPANION_PAIRING_TOKEN,
    };
  }
  return config;
}

export async function getLanAddresses(port) {
  const interfaces = os.networkInterfaces();
  const urls = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        urls.push(`http://${entry.address}:${port}`);
      }
    }
  }
  return urls;
}

export function makeSnapshotId(input = new Date()) {
  const stamp = new Date(input).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const nonce = crypto.randomBytes(4).toString("hex");
  return `${stamp}-${nonce}`;
}

export async function saveSnapshot(payload) {
  await ensureStorage();
  const createdAt = payload.createdAt ? new Date(payload.createdAt) : new Date();
  const id = makeSnapshotId(createdAt);
  const snapshotDir = path.join(snapshotsDir, id);
  const rawDir = path.join(snapshotDir, "raw");
  await fs.mkdir(rawDir, { recursive: true });

  const files = [];
  for (const inputFile of payload.files ?? []) {
    const relativePath = normalizeRelativePath(inputFile.relativePath);
    const absolutePath = safeJoin(rawDir, relativePath);
    const content = Buffer.from(inputFile.contentBase64 ?? "", "base64");
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content);
    files.push({
      kind: normalizeKind(inputFile.kind),
      relativePath,
      size: content.length,
      mtimeMs: Number(inputFile.mtimeMs ?? 0),
      sha256: sha256(content),
      providedSha256: inputFile.sha256 ?? null,
    });
  }

  const manifest = {
    id,
    createdAt: createdAt.toISOString(),
    receivedAt: new Date().toISOString(),
    deckName: String(payload.deckName ?? "steam-deck"),
    pluginVersion: String(payload.pluginVersion ?? "unknown"),
    savesRoot: String(payload.savesRoot ?? ""),
    filtersRoot: String(payload.filtersRoot ?? ""),
    fileCount: files.length,
    files,
  };

  await writeJson(path.join(snapshotDir, "snapshot.json"), manifest);
  return manifest;
}

export async function listSnapshots() {
  await ensureStorage();
  const entries = await fs.readdir(snapshotsDir, { withFileTypes: true });
  const snapshots = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const snapshotDir = path.join(snapshotsDir, entry.name);
    try {
      const manifest = await readJson(path.join(snapshotDir, "snapshot.json"));
      const analysis = await maybeReadJson(path.join(snapshotDir, "analysis.json"));
      snapshots.push({
        id: manifest.id,
        createdAt: manifest.createdAt,
        receivedAt: manifest.receivedAt,
        deckName: manifest.deckName,
        pluginVersion: manifest.pluginVersion,
        fileCount: manifest.fileCount,
        analysisSummary: analysis?.summary ?? null,
      });
    } catch {
      // Ignore incomplete snapshot folders.
    }
  }
  return snapshots.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function readSnapshot(id) {
  const snapshotDir = path.join(snapshotsDir, normalizeId(id));
  const manifest = await readJson(path.join(snapshotDir, "snapshot.json"));
  const analysis = await maybeReadJson(path.join(snapshotDir, "analysis.json"));
  return {
    manifest,
    analysis,
    snapshotDir,
    rawDir: path.join(snapshotDir, "raw"),
  };
}

export async function writeAnalysis(id, analysis) {
  const snapshotDir = path.join(snapshotsDir, normalizeId(id));
  await writeJson(path.join(snapshotDir, "analysis.json"), analysis);
}

export async function writeGeneratedFilter(id, fileName, xml) {
  const safeName = normalizeRelativePath(fileName).replace(/[\\/]/g, "_");
  const snapshotGeneratedDir = path.join(generatedDir, normalizeId(id));
  await fs.mkdir(snapshotGeneratedDir, { recursive: true });
  const outputPath = path.join(snapshotGeneratedDir, safeName);
  await fs.writeFile(outputPath, xml, "utf8");
  return outputPath;
}

export async function readGeneratedFilter(id, fileName) {
  const safeName = normalizeRelativePath(fileName).replace(/[\\/]/g, "_");
  return fs.readFile(path.join(generatedDir, normalizeId(id), safeName), "utf8");
}

export function normalizeRelativePath(value) {
  const normalized = String(value ?? "unnamed")
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  return normalized || "unnamed";
}

export function safeJoin(root, relativePath) {
  const target = path.resolve(root, normalizeRelativePath(relativePath));
  const resolvedRoot = path.resolve(root);
  if (!target.startsWith(resolvedRoot + path.sep) && target !== resolvedRoot) {
    throw new Error("Path escapes storage root.");
  }
  return target;
}

export function normalizeId(value) {
  const id = String(value ?? "");
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error("Invalid snapshot id.");
  }
  return id;
}

export function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function maybeReadJson(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function normalizeKind(value) {
  const kind = String(value ?? "").toLowerCase();
  if (["save", "filter", "other"].includes(kind)) return kind;
  return "other";
}
