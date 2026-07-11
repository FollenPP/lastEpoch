import test from "node:test";
import assert from "node:assert/strict";
import { decodeItemRecord, estimateRawItemScore, normalizeBytes } from "../src/item-decoder.js";

test("decodeItemRecord extracts raw bytes, metadata, and stable identity", () => {
  const record = {
    itemData: {
      data: [9, 8, 7, 6, 260, -1],
      baseType: 42,
    },
    quantity: 2,
    containerID: 6,
    inventoryPosition: [1, 2],
    formatVersion: 3,
  };
  const context = {
    source: "Saves/STASH_CYCLE_7_1_TAB_0",
    sourceType: "stash-tab",
    sourceName: "idols",
    recordIndex: 0,
  };

  const first = decodeItemRecord(record, context);
  const second = decodeItemRecord(record, context);

  assert.equal(first.id, second.id);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.decoderStatus, "raw-bytes");
  assert.equal(first.byteLength, 6);
  assert.equal(first.metadata.quantity, 2);
  assert.equal(first.metadata.containerId, 6);
  assert.equal(first.metadata.inventoryPosition, "1, 2");
  assert.equal(first.metadata.directFields.baseType, 42);
  assert.match(first.previewHex, /^09 08 07 06 04 ff/);
  assert.ok(estimateRawItemScore(first) > 40);
});

test("decodeItemRecord maps legacy item arrays into game item fields", () => {
  const decoded = decodeItemRecord({
    data: [1, 21, 2, 4, 200, 0, 0, 42, 2, 80, 12, 220, 16, 33, 128, 0],
    quantity: 1,
    containerID: 9,
    inventoryPosition: { x: 3, y: 4 },
  });

  assert.equal(decoded.decoderStatus, "decoded-item");
  assert.equal(decoded.metadata.equipmentSlot, "ring");
  assert.equal(decoded.gameItem.itemType.name, "Rings");
  assert.equal(decoded.gameItem.slot, "ring");
  assert.equal(decoded.gameItem.rarity.id, "exalted");
  assert.equal(decoded.gameItem.forgingPotential, 42);
  assert.equal(decoded.gameItem.affixes.length, 2);
  assert.deepEqual(decoded.gameItem.affixes[0], {
    tier: 6,
    typeMod: 0,
    affixId: 12,
    roll: 220,
    rollPercent: 86,
    label: "Affix 12",
  });
});

test("decodeItemRecord handles metadata-only records", () => {
  const decoded = decodeItemRecord({ quantity: 1, containerID: 3 }, { source: "Saves/1CHARACTERSLOT_BETA_0" });

  assert.equal(decoded.decoderStatus, "metadata-only");
  assert.equal(decoded.byteLength, 0);
  assert.ok(decoded.warnings.some((warning) => warning.includes("No raw byte array")));
  assert.ok(estimateRawItemScore(decoded) > 0);
});

test("decodeItemRecord infers equipped location and slot from record path", () => {
  const decoded = decodeItemRecord(
    { itemData: { data: [1, 2, 3, 4] }, quantity: 1 },
    {
      source: "Saves/1CHARACTERSLOT_BETA_0",
      sourceType: "character",
      recordPath: ["savedCharacter", "equippedItems", "helmet"],
    },
  );

  assert.equal(decoded.metadata.locationType, "equipped");
  assert.equal(decoded.metadata.equipmentSlot, "helmet");
  assert.equal(decoded.metadata.itemKind, "helmet");
  assert.equal(decoded.metadata.recordPath, "savedCharacter.equippedItems.helmet");
  assert.ok(decoded.labels.includes("path-aware"));
});

test("normalizeBytes keeps values inside unsigned byte range", () => {
  assert.deepEqual(normalizeBytes([0, 255, 256, -1, "7", "bad", null]), [0, 255, 0, 255, 7]);
});
