import crypto from "node:crypto";

const BYTE_PREVIEW_LENGTH = 24;
const METADATA_KEYS = [
  "baseType",
  "subType",
  "itemId",
  "itemID",
  "uniqueId",
  "uniqueID",
  "rarity",
  "legendaryPotential",
  "weaversWill",
  "forgingPotential",
  "levelRequirement",
  "classRequirement",
];

export function decodeItemRecord(record, context = {}) {
  const byteSource = extractByteSource(record);
  const bytes = normalizeBytes(byteSource.values);
  const metadata = extractMetadata(record, context);
  const hashSeed = bytes.length > 0 ? Buffer.from(bytes) : JSON.stringify({ metadata, source: context.source ?? "" });
  const fingerprint = crypto.createHash("sha256").update(hashSeed).digest("hex").slice(0, 20);
  const locationHash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ source: context.source ?? "", index: context.recordIndex ?? 0, position: metadata.inventoryPosition ?? "" }))
    .digest("hex")
    .slice(0, 8);
  const nonZeroBytes = bytes.filter((value) => value !== 0).length;
  const byteLength = bytes.length;
  const warnings = [];

  if (!byteLength) warnings.push("No raw byte array was found for this item record.");
  if (byteSource.droppedValues > 0) warnings.push(`${byteSource.droppedValues} raw values were ignored because they are not numeric bytes.`);

  return {
    id: `item-${fingerprint}-${locationHash}`,
    fingerprint,
    decoderStatus: byteLength > 0 ? "raw-bytes" : hasUsefulMetadata(metadata) ? "metadata-only" : "empty",
    confidence: "low",
    bytePath: byteSource.path,
    byteLength,
    checksum: checksum(bytes),
    nonZeroBytes,
    zeroBytes: byteLength - nonZeroBytes,
    uniqueByteCount: new Set(bytes).size,
    previewHex: hexPreview(bytes, BYTE_PREVIEW_LENGTH),
    previewDec: bytes.slice(0, 16),
    headerHex: hexPreview(bytes, 8),
    tailHex: hexPreview(bytes.slice(-8), 8),
    metadata,
    labels: buildLabels(byteSource.path, context),
    warnings,
  };
}

export function estimateRawItemScore(decodedItem) {
  if (!decodedItem || decodedItem.decoderStatus === "empty") return 0;

  const byteLength = numberValue(decodedItem.byteLength) ?? 0;
  const nonZeroRatio = byteLength > 0 ? (numberValue(decodedItem.nonZeroBytes) ?? 0) / byteLength : 0;
  const uniqueByteCount = numberValue(decodedItem.uniqueByteCount) ?? 0;
  const metadata = decodedItem.metadata ?? {};
  let score = decodedItem.decoderStatus === "raw-bytes" ? 24 : 8;

  score += Math.min(30, Math.round(byteLength / 2));
  score += Math.min(18, uniqueByteCount * 2);
  score += Math.round(nonZeroRatio * 15);
  if (metadata.quantity !== null && metadata.quantity !== undefined) score += 4;
  if (metadata.containerId !== null && metadata.containerId !== undefined) score += 5;
  if (metadata.inventoryPosition) score += 4;
  if (metadata.formatVersion !== null && metadata.formatVersion !== undefined) score += 3;
  if (Object.keys(metadata.directFields ?? {}).length > 0) score += 7;

  return clamp(score, 0, 100);
}

export function normalizeBytes(values) {
  if (!Array.isArray(values)) return [];
  const bytes = [];
  for (const value of values) {
    const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    if (!Number.isFinite(number)) continue;
    bytes.push(((Math.trunc(number) % 256) + 256) % 256);
  }
  return bytes;
}

function extractByteSource(record) {
  const candidates = [
    ["itemData.data", record?.itemData?.data],
    ["itemData", record?.itemData],
    ["data", record?.data],
    ["rawData", record?.rawData],
    ["serializedData", record?.serializedData],
  ];
  for (const [path, values] of candidates) {
    if (!Array.isArray(values)) continue;
    const normalized = normalizeBytes(values);
    return {
      path,
      values,
      droppedValues: values.length - normalized.length,
    };
  }
  return { path: null, values: [], droppedValues: 0 };
}

function extractMetadata(record, context) {
  const itemData = isObject(record?.itemData) ? record.itemData : {};
  return {
    source: context.source ?? null,
    sourceType: context.sourceType ?? "unknown",
    sourceName: context.sourceName ?? null,
    recordIndex: numberValue(context.recordIndex),
    quantity: numberValue(firstDefined(record?.quantity, itemData.quantity)),
    containerId: numberValue(firstDefined(record?.containerID, record?.containerId, itemData.containerID, itemData.containerId)),
    inventoryPosition: summarizePosition(firstDefined(record?.inventoryPosition, itemData.inventoryPosition)),
    formatVersion: numberValue(firstDefined(record?.formatVersion, itemData.formatVersion)),
    directFields: pickDirectFields(record, itemData),
  };
}

function pickDirectFields(record, itemData) {
  const fields = {};
  for (const key of METADATA_KEYS) {
    const value = firstDefined(record?.[key], itemData?.[key]);
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "object") continue;
    fields[key] = value;
  }
  return fields;
}

function buildLabels(bytePath, context) {
  return [bytePath, context.sourceType, context.sourceName ? "named-source" : null].filter(Boolean);
}

function hasUsefulMetadata(metadata) {
  return Boolean(
    metadata.quantity !== null ||
      metadata.containerId !== null ||
      metadata.inventoryPosition ||
      metadata.formatVersion !== null ||
      Object.keys(metadata.directFields ?? {}).length > 0,
  );
}

function checksum(bytes) {
  return bytes.reduce((sum, value) => (sum + value) % 65536, 0);
}

function hexPreview(bytes, length) {
  return bytes
    .slice(0, length)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join(" ");
}

function summarizePosition(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}
