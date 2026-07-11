import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyzeFile, analyzeSnapshot } from "../src/analyzer.js";
import { generateReviewFilter } from "../src/filter-generator.js";

test("analyzeFile classifies stash files and extracts text signals", () => {
  const result = analyzeFile(
    {
      kind: "save",
      relativePath: "STASH_CYCLE_0_TAB_1",
      size: 64,
      mtimeMs: 0,
      sha256: "hash",
    },
    Buffer.from("unique exalted idol health resistance affix"),
  );

  assert.equal(result.classification, "stash");
  assert.equal(result.readable, true);
  assert.ok(result.itemSignalCount >= 5);
});

test("analyzeFile reads basic loot filter stats", () => {
  const result = analyzeFile(
    {
      kind: "filter",
      relativePath: "MyFilter.xml",
      size: 256,
      mtimeMs: 0,
      sha256: "hash",
    },
    Buffer.from(`
      <ItemFilter xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
        <name>My Filter</name>
        <rules>
          <Rule><type>SHOW</type></Rule>
          <Rule><type>HIDE</type></Rule>
          <rule><type>highlight</type></rule>
        </rules>
      </ItemFilter>
    `),
  );

  assert.equal(result.classification, "filter");
  assert.deepEqual(result.filterStats, {
    name: "My Filter",
    ruleCount: 3,
    showCount: 1,
    hideCount: 1,
    highlightCount: 1,
  });
});

test("analyzeFile parses EPOCH-prefixed character JSON", () => {
  const result = analyzeFile(
    {
      kind: "save",
      relativePath: "1CHARACTERSLOT_BETA_1",
      size: 512,
      mtimeMs: 0,
      sha256: "hash",
    },
    Buffer.from(
      `EPOCH{"characterName":"AdletM","level":42,"hardcore":false,"died":false,"deaths":0,"savedCharacterTree":{"treeID":3,"nodeIDs":[1,2,3],"nodePoints":[5,3,1],"unspentPoints":2},"savedSkillTrees":[{"treeID":10},{"treeID":11}],"abilityBar":{"slot0":"sp5g2","slot1":"ws54hm"}}`,
    ),
  );

  assert.equal(result.classification, "character");
  assert.equal(result.json.rootType, "object");
  assert.equal(result.gameSummary.name, "AdletM");
  assert.equal(result.gameSummary.level, 42);
  assert.equal(result.gameSummary.passiveTree.nodeIds, 3);
  assert.equal(result.gameSummary.skills.specializedTrees, 2);
});

test("analyzeSnapshot creates one card per item record", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "le-analyzer-"));
  try {
    await fs.writeFile(
      path.join(tempDir, "STASH_CYCLE_7_1_TAB_0"),
      `EPOCH{"displayName":"idols","savedItems":[{"itemData":{"data":[9,8,7,6]},"quantity":2,"containerID":6,"inventoryPosition":[1,2],"formatVersion":3}]}`,
      "utf8",
    );
    const manifest = {
      id: "test",
      files: [
        {
          kind: "save",
          relativePath: "STASH_CYCLE_7_1_TAB_0",
          size: 128,
          mtimeMs: 0,
          sha256: "hash",
        },
      ],
    };

    const analysis = await analyzeSnapshot(manifest, tempDir);

    assert.equal(analysis.game.items.totalRecords, 1);
    assert.equal(analysis.game.items.cards[0].sourceName, "idols");
    assert.equal(analysis.game.items.cards[0].dataLength, 4);
    assert.equal(analysis.game.items.cards[0].decoderStatus, "raw-bytes");
    assert.equal(analysis.game.items.cards[0].decoded.byteLength, 4);
    assert.equal(analysis.game.items.cards[0].decoded.previewHex, "09 08 07 06");
    assert.match(analysis.game.items.cards[0].fingerprint, /^[a-f0-9]{20}$/);
    assert.ok(analysis.game.items.cards[0].score > 0);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("analyzeSnapshot marks character item records as equipped when path exposes a slot", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "le-analyzer-equipment-"));
  try {
    await fs.writeFile(
      path.join(tempDir, "1CHARACTERSLOT_BETA_0"),
      `EPOCH{"characterName":"AdletM","level":72,"equippedItems":{"helmet":{"itemData":{"data":[1,2,3,4]},"quantity":1,"formatVersion":3}}}`,
      "utf8",
    );
    const manifest = {
      id: "equipment-test",
      files: [
        {
          kind: "save",
          relativePath: "1CHARACTERSLOT_BETA_0",
          size: 128,
          mtimeMs: 0,
          sha256: "hash",
        },
      ],
    };

    const analysis = await analyzeSnapshot(manifest, tempDir);
    const card = analysis.game.items.cards[0];

    assert.equal(analysis.game.items.totalRecords, 1);
    assert.equal(card.sourceType, "character");
    assert.equal(card.locationType, "equipped");
    assert.equal(card.equipmentSlot, "helmet");
    assert.equal(card.recordPath, "equippedItems.helmet");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("generateReviewFilter creates a conservative non-hiding filter", () => {
  const xml = generateReviewFilter({ snapshotId: "20260710-test" });

  assert.match(xml, /<ItemFilter/);
  assert.match(xml, /<type>SHOW<\/type>/);
  assert.doesNotMatch(xml, /<type>HIDE<\/type>/);
});
