import crypto from "node:crypto";

const BYTE_PREVIEW_LENGTH = 24;
const METADATA_KEYS = [
  "baseType",
  "subType",
  "itemType",
  "itemTypeId",
  "itemTypeID",
  "itemId",
  "itemID",
  "uniqueId",
  "uniqueID",
  "rarity",
  "slot",
  "slotId",
  "slotID",
  "equipmentSlot",
  "equipmentSlotId",
  "equipmentSlotID",
  "legendaryPotential",
  "weaversWill",
  "forgingPotential",
  "levelRequirement",
  "classRequirement",
];

const SLOT_RULES = [
  { slot: "helmet", tokens: ["helmet", "helm", "head"] },
  { slot: "body", tokens: ["body", "chest", "armor", "armour", "torso"] },
  { slot: "gloves", tokens: ["glove", "hand"] },
  { slot: "boots", tokens: ["boot", "feet"] },
  { slot: "belt", tokens: ["belt"] },
  { slot: "relic", tokens: ["relic"] },
  { slot: "amulet", tokens: ["amulet", "neck"] },
  { slot: "ring", tokens: ["ring"] },
  { slot: "weapon", tokens: ["weapon", "mainhand", "main-hand", "main_hand"] },
  { slot: "offhand", tokens: ["offhand", "off-hand", "off_hand", "catalyst", "shield"] },
  { slot: "idol", tokens: ["idol"] },
];

const ITEM_TYPES = {
  0: { name: "Helmets", slot: "helmet", icon: "helm" },
  1: { name: "Body Armours", slot: "body", icon: "armor" },
  2: { name: "Belts", slot: "belt", icon: "belt" },
  3: { name: "Boots", slot: "boots", icon: "boots" },
  4: { name: "Gloves", slot: "gloves", icon: "gloves" },
  5: { name: "1H Axes", slot: "weapon", icon: "axe" },
  6: { name: "Daggers", slot: "weapon", icon: "dagger" },
  7: { name: "1H Blunt Weapons", slot: "weapon", icon: "mace" },
  8: { name: "Sceptres", slot: "weapon", icon: "sceptre" },
  9: { name: "1H Swords", slot: "weapon", icon: "sword" },
  10: { name: "Wands", slot: "weapon", icon: "wand" },
  11: { name: "Fists", slot: "weapon", icon: "fist" },
  12: { name: "2H Axes", slot: "weapon", icon: "axe" },
  13: { name: "2H Blunt Weapons", slot: "weapon", icon: "mace" },
  14: { name: "Polearms", slot: "weapon", icon: "polearm" },
  15: { name: "Staffs", slot: "weapon", icon: "staff" },
  16: { name: "2H Swords", slot: "weapon", icon: "sword" },
  17: { name: "Quivers", slot: "offhand", icon: "quiver" },
  18: { name: "Shields", slot: "offhand", icon: "shield" },
  19: { name: "Catalysts", slot: "offhand", icon: "catalyst" },
  20: { name: "Amulets", slot: "amulet", icon: "amulet" },
  21: { name: "Rings", slot: "ring", icon: "ring" },
  22: { name: "Relics", slot: "relic", icon: "relic" },
  23: { name: "Bows", slot: "weapon", icon: "bow" },
  24: { name: "Crossbows", slot: "weapon", icon: "crossbow" },
  25: { name: "Small Eterran Idols", slot: "idol", icon: "idol" },
  26: { name: "Small Lagonian Idols", slot: "idol", icon: "idol" },
  27: { name: "Humble Eterran Idols", slot: "idol", icon: "idol" },
  28: { name: "Stout Lagonian Idols", slot: "idol", icon: "idol" },
  29: { name: "Grand Idols", slot: "idol", icon: "idol" },
  30: { name: "Large Idols", slot: "idol", icon: "idol" },
  31: { name: "Ornate Idols", slot: "idol", icon: "idol" },
  32: { name: "Huge Idols", slot: "idol", icon: "idol" },
  33: { name: "Adorned Idols", slot: "idol", icon: "idol" },
  34: { name: "Blessings", slot: "blessing", icon: "blessing" },
};

const RARITIES = {
  0: { id: "normal", label: "Normal" },
  1: { id: "magic", label: "Magic" },
  2: { id: "rare", label: "Rare" },
  3: { id: "rare", label: "Rare" },
  4: { id: "exalted", label: "Exalted" },
  7: { id: "unique", label: "Unique" },
  8: { id: "set", label: "Set" },
  9: { id: "legendary", label: "Legendary" },
};

const AFFIX_TIER_BASES = [
  { tier: 7, value: 96 },
  { tier: 6, value: 80 },
  { tier: 5, value: 64 },
  { tier: 4, value: 48 },
  { tier: 3, value: 32 },
  { tier: 2, value: 16 },
  { tier: 1, value: 0 },
];

export function decodeItemRecord(record, context = {}) {
  const byteSource = extractByteSource(record);
  const bytes = normalizeBytes(byteSource.values);
  let metadata = extractMetadata(record, context);
  const gameItem = decodeGameItem(bytes, metadata);
  if (gameItem?.slot && !metadata.equipmentSlot) {
    metadata = {
      ...metadata,
      equipmentSlot: gameItem.slot,
      itemKind: gameItem.itemType?.name ?? gameItem.slot,
    };
  }
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
  if (byteLength && !gameItem) warnings.push("The item byte layout is not mapped yet; this record is kept as diagnostics only.");

  return {
    id: `item-${fingerprint}-${locationHash}`,
    fingerprint,
    decoderStatus: gameItem ? gameItem.decoderStatus : byteLength > 0 ? "raw-bytes" : hasUsefulMetadata(metadata) ? "metadata-only" : "empty",
    confidence: gameItem ? gameItem.confidence : "low",
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
    gameItem,
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
  if (decodedItem.gameItem) {
    score += 15;
    score += Math.min(28, decodedItem.gameItem.affixes.length * 6 + decodedItem.gameItem.affixes.reduce((sum, affix) => sum + affix.tier, 0));
    if (decodedItem.gameItem.rarity?.id === "exalted") score += 18;
    if (decodedItem.gameItem.rarity?.id === "unique" || decodedItem.gameItem.rarity?.id === "legendary") score += 14;
  }

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

function decodeGameItem(bytes, metadata) {
  const directItem = decodeDirectFields(metadata?.directFields ?? {});
  if (directItem) return directItem;

  const legacy = decodeLegacyArrayItem(bytes);
  if (legacy) return legacy;

  return null;
}

function decodeDirectFields(fields) {
  const itemTypeId = numberValue(firstDefined(fields.itemTypeId, fields.itemTypeID, fields.itemType));
  const itemType = ITEM_TYPES[itemTypeId] ?? null;
  const rarity = rarityFromValue(fields.rarity);
  const baseName = stringValue(firstDefined(fields.baseType, fields.uniqueID, fields.uniqueId, fields.itemId, fields.itemID));

  if (!itemType && !baseName && !rarity) return null;

  return {
    decoderStatus: "decoded-item",
    confidence: "medium",
    format: "direct-fields",
    name: baseName ?? itemType?.name ?? "Unknown item",
    baseName: baseName ?? null,
    itemType,
    slot: normalizeSlotName(firstDefined(fields.equipmentSlot, fields.slot)) ?? itemType?.slot ?? null,
    rarity: rarity ?? { id: "normal", label: "Item" },
    implicits: [],
    affixes: [],
    forgingPotential: numberValue(fields.forgingPotential),
    legendaryPotential: numberValue(fields.legendaryPotential),
    weaversWill: numberValue(fields.weaversWill),
    rawLayout: null,
  };
}

function decodeLegacyArrayItem(bytes) {
  for (const offset of [0, 1, 2, 3]) {
    const decoded = decodeLegacyArrayAtOffset(bytes, offset);
    if (decoded) return decoded;
  }
  return null;
}

function decodeLegacyArrayAtOffset(bytes, offset) {
  if (!Array.isArray(bytes) || bytes.length - offset < 10) return null;

  const version = bytes[offset];
  const itemTypeId = bytes[offset + 1];
  const baseId = bytes[offset + 2];
  const rarityValue = bytes[offset + 3];
  const implicitValue1 = bytes[offset + 4];
  const implicitValue2 = bytes[offset + 5];
  const implicitValue3 = bytes[offset + 6];
  const forgingPotential = bytes[offset + 7];
  const affixCount = bytes[offset + 8];
  const affixStart = offset + 9;
  const affixEnd = affixStart + affixCount * 3;

  if (!isPlausibleLegacyItem({ version, itemTypeId, baseId, rarityValue, affixCount, affixEnd, length: bytes.length })) {
    return null;
  }

  const itemType = ITEM_TYPES[itemTypeId];
  const rarity = RARITIES[rarityValue] ?? inferRarityFromAffixes(bytes.slice(affixStart, affixEnd));
  const affixes = [];
  for (let i = affixStart; i + 2 < affixEnd; i += 3) {
    const tierToken = bytes[i];
    const affixTier = decodeAffixTier(tierToken);
    affixes.push({
      tier: affixTier.tier,
      typeMod: affixTier.typeMod,
      affixId: bytes[i + 1],
      roll: bytes[i + 2],
      rollPercent: percentOf255(bytes[i + 2]),
      label: `Affix ${bytes[i + 1]}`,
    });
  }

  return {
    decoderStatus: "decoded-item",
    confidence: version === 0 || version === 1 ? "medium" : "low",
    format: "legacy-array",
    name: `${itemType.name} base ${baseId}`,
    baseName: `Base ${baseId}`,
    itemType,
    slot: itemType.slot,
    rarity,
    implicits: [
      { label: "Implicit 1", roll: implicitValue1, rollPercent: percentOf255(implicitValue1) },
      { label: "Implicit 2", roll: implicitValue2, rollPercent: percentOf255(implicitValue2) },
      { label: "Implicit 3", roll: implicitValue3, rollPercent: percentOf255(implicitValue3) },
    ].filter((item) => item.roll !== 0),
    affixes,
    forgingPotential,
    legendaryPotential: bytes[affixEnd] ?? null,
    rawLayout: {
      offset,
      version,
      itemTypeId,
      baseId,
      rarityValue,
      affixCount,
    },
  };
}

function isPlausibleLegacyItem({ version, itemTypeId, baseId, rarityValue, affixCount, affixEnd, length }) {
  if (!Number.isInteger(version) || version < 0 || version > 10) return false;
  if (!ITEM_TYPES[itemTypeId]) return false;
  if (!Number.isInteger(baseId) || baseId < 0 || baseId > 140) return false;
  if (!RARITIES[rarityValue]) return false;
  if (!Number.isInteger(affixCount) || affixCount < 0 || affixCount > 6) return false;
  if (affixEnd > length) return false;
  return true;
}

function inferRarityFromAffixes(rawAffixBytes) {
  const hasExalted = rawAffixBytes.some((value, index) => index % 3 === 0 && value >= 80);
  if (hasExalted) return RARITIES[4];
  return rawAffixBytes.length >= 12 ? RARITIES[2] : RARITIES[1];
}

function decodeAffixTier(value) {
  for (const base of AFFIX_TIER_BASES) {
    if (value >= base.value && value <= base.value + 2) {
      return { tier: base.tier, typeMod: value - base.value };
    }
  }
  return { tier: 1, typeMod: 0 };
}

function rarityFromValue(value) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = numberValue(value);
  if (numeric !== null && RARITIES[numeric]) return RARITIES[numeric];
  const normalized = String(value).toLowerCase();
  return (
    Object.values(RARITIES).find((rarity) => normalized.includes(rarity.id) || normalized.includes(rarity.label.toLowerCase())) ??
    null
  );
}

function extractMetadata(record, context) {
  const itemData = isObject(record?.itemData) ? record.itemData : {};
  const recordPath = normalizeRecordPath(context.recordPath);
  const directFields = pickDirectFields(record, itemData);
  const equipmentSlot = inferEquipmentSlot(record, itemData, recordPath, directFields);
  const locationType = inferLocationType(context, recordPath, equipmentSlot);
  return {
    source: context.source ?? null,
    sourceType: context.sourceType ?? "unknown",
    sourceName: context.sourceName ?? null,
    recordIndex: numberValue(context.recordIndex),
    recordPath,
    locationType,
    equipmentSlot,
    itemKind: inferItemKind(record, itemData, directFields, equipmentSlot),
    quantity: numberValue(firstDefined(record?.quantity, itemData.quantity)),
    containerId: numberValue(firstDefined(record?.containerID, record?.containerId, itemData.containerID, itemData.containerId)),
    inventoryPosition: summarizePosition(firstDefined(record?.inventoryPosition, itemData.inventoryPosition)),
    formatVersion: numberValue(firstDefined(record?.formatVersion, itemData.formatVersion)),
    directFields,
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
  return [bytePath, context.sourceType, context.sourceName ? "named-source" : null, context.recordPath ? "path-aware" : null].filter(Boolean);
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
  if (isObject(value)) return Object.values(value).map((item) => String(item)).join(", ");
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function normalizeRecordPath(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(".");
  if (typeof value === "string") return value;
  return "";
}

function inferLocationType(context, recordPath, equipmentSlot) {
  const sourceType = String(context.sourceType ?? "").toLowerCase();
  const path = String(recordPath ?? "").toLowerCase();
  if (sourceType === "stash" || sourceType === "stash-tab") return "stash";
  if (sourceType === "character") {
    if (path.includes("inventory") || path.includes("backpack") || path.includes("bag")) return "inventory";
    if (path.includes("idol")) return "idol";
    if (path.includes("equipped") || path.includes("equipment") || path.includes("gear") || equipmentSlot) return "equipped";
    return "character";
  }
  return sourceType || "unknown";
}

function inferEquipmentSlot(record, itemData, recordPath, directFields) {
  const directValue = firstDefined(
    record?.equipmentSlot,
    record?.equipmentSlotId,
    record?.equipmentSlotID,
    record?.slot,
    record?.slotId,
    record?.slotID,
    itemData?.equipmentSlot,
    itemData?.equipmentSlotId,
    itemData?.equipmentSlotID,
    itemData?.slot,
    itemData?.slotId,
    itemData?.slotID,
    directFields.equipmentSlot,
    directFields.slot,
  );
  const normalizedDirect = normalizeSlotName(directValue);
  if (normalizedDirect) return normalizedDirect;

  const path = String(recordPath ?? "").toLowerCase();
  for (const rule of SLOT_RULES) {
    if (rule.tokens.some((token) => path.includes(token))) return rule.slot;
  }
  return null;
}

function inferItemKind(record, itemData, directFields, equipmentSlot) {
  const rawKind = firstDefined(
    record?.itemKind,
    record?.itemType,
    record?.itemTypeId,
    record?.itemTypeID,
    record?.baseType,
    itemData?.itemKind,
    itemData?.itemType,
    itemData?.itemTypeId,
    itemData?.itemTypeID,
    itemData?.baseType,
    directFields.itemType,
    directFields.baseType,
  );
  const slotKind = normalizeSlotName(rawKind);
  if (slotKind) return slotKind;
  if (rawKind !== undefined && rawKind !== null && rawKind !== "") return String(rawKind);
  return equipmentSlot ?? null;
}

function normalizeSlotName(value) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!normalized) return null;
  for (const rule of SLOT_RULES) {
    if (rule.tokens.some((token) => normalized.includes(token.replace(/[^a-z0-9]+/g, "")))) return rule.slot;
  }
  return null;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function percentOf255(value) {
  const number = numberValue(value);
  return number === null ? null : clamp((number / 255) * 100, 0, 100);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}
