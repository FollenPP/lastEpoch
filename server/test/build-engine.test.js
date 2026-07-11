import test from "node:test";
import assert from "node:assert/strict";
import { buildAnalyzerSnapshot, searchStashUpgrades } from "../src/build-engine.js";

test("buildAnalyzerSnapshot creates normalized model, issues, recommendations, and plan", () => {
  const snapshot = {
    id: "20260711-test",
    createdAt: "2026-07-11T00:00:00.000Z",
    receivedAt: "2026-07-11T00:00:01.000Z",
    deckName: "Steam Deck",
    pluginVersion: "0.1.10",
    fileCount: 3,
    source: {
      kind: "companion",
      companion: "decky-plugin",
      apiVersion: "v1",
    },
  };
  const analysis = {
    summary: {
      totalFiles: 3,
      characterFiles: 1,
      stashFiles: 1,
      filterFiles: 1,
      parserCoverage: 100,
    },
    game: {
      characters: [
        {
          name: "AdletM",
          file: "Saves/1CHARACTERSLOT_BETA_0",
          level: 72,
          hardcore: true,
          deaths: 0,
          passiveTree: {
            treeId: 12,
            nodeIds: 50,
            nodePoints: 50,
            unspentPoints: 2,
            nodeIdsList: [101, 102, 103],
            nodePointsList: [5, 3, 1],
          },
          skills: {
            specializedTrees: 3,
            abilityBarSlots: 4,
            abilityCodes: ["fireball", "teleport"],
            abilitySlots: [
              { slot: "slot0", code: "fireball" },
              { slot: "slot1", code: "teleport" },
            ],
            trees: [
              {
                treeId: 90,
                abilityCode: "fireball",
                nodes: 2,
                nodePoints: 2,
                pointsAllocated: 8,
                nodeIdsList: [201, 202],
                nodePointsList: [5, 3],
              },
            ],
          },
          quests: {
            completedObjectives: 10,
          },
        },
      ],
      stash: {
        files: [{ file: "Saves/STASH_CYCLE_7_1", stashName: "Cycle", gold: 1000, tabs: 1, itemRecords: 1 }],
        tabs: [{ file: "Saves/STASH_CYCLE_7_1_TAB_0", displayName: "idols", itemRecords: 1 }],
        totalGold: 1000,
        totalItemRecords: 1,
        namedTabs: ["idols"],
      },
      items: {
        totalRecords: 1,
        cards: [
          {
            source: "Saves/STASH_CYCLE_7_1_TAB_0",
            sourceType: "stash-tab",
            sourceName: "idols",
            quantity: 1,
            containerId: 3,
            inventoryPosition: "1, 2",
            formatVersion: 3,
            dataLength: 12,
            fingerprint: "abc123def4567890abcd",
            locationType: "stash",
            equipmentSlot: "helmet",
            itemKind: "helmet",
            decoderStatus: "raw-bytes",
            score: 58,
            decoded: {
              fingerprint: "abc123def4567890abcd",
              decoderStatus: "raw-bytes",
              byteLength: 12,
              previewHex: "09 08 07 06",
              checksum: 30,
              metadata: {
                quantity: 1,
                containerId: 3,
                inventoryPosition: "1, 2",
                directFields: {},
              },
            },
          },
          {
            source: "Saves/1CHARACTERSLOT_BETA_0",
            sourceType: "character",
            sourceName: "AdletM",
            quantity: 1,
            containerId: null,
            inventoryPosition: "",
            formatVersion: 3,
            dataLength: 8,
            fingerprint: "equipped1234567890aa",
            locationType: "equipped",
            equipmentSlot: "helmet",
            itemKind: "helmet",
            recordPath: "equippedItems.helmet",
            decoderStatus: "raw-bytes",
            score: 40,
            decoded: {
              fingerprint: "equipped1234567890aa",
              decoderStatus: "raw-bytes",
              byteLength: 8,
              previewHex: "01 02 03 04",
              checksum: 10,
              metadata: {
                locationType: "equipped",
                equipmentSlot: "helmet",
                itemKind: "helmet",
                recordPath: "equippedItems.helmet",
                directFields: {},
              },
            },
          },
        ],
      },
      filters: [{ file: "Filters/Test.xml", stats: { name: "Test", ruleCount: 3 } }],
      build: {
        hasPassiveTreeData: true,
        hasSkillTreeData: true,
        parserStage: "epoch-json",
      },
    },
  };

  const result = buildAnalyzerSnapshot(snapshot, analysis);

  assert.equal(result.model.characters[0].name, "AdletM");
  assert.equal(result.model.knowledge.phase, "endgame");
  assert.equal(result.model.knowledge.archetype.primary, "hit-caster");
  assert.ok(result.model.knowledge.tags.damage.includes("fire"));
  assert.ok(result.metrics.knowledgeReadiness > 0);
  assert.equal(result.model.characters[0].equipment.equippedItems.length, 1);
  assert.deepEqual(result.model.characters[0].passiveTree.nodeIdsList, [101, 102, 103]);
  assert.equal(result.model.characters[0].skills.trees[0].treeId, 90);
  assert.deepEqual(result.model.characters[0].skills.abilitySlots[0], { slot: "slot0", code: "fireball" });
  assert.equal(result.model.characters[0].equipment.slots.helmet.fingerprint, "equipped1234567890aa");
  assert.equal(result.model.stash.upgradeCandidates.length, 1);
  assert.equal(result.model.stash.itemCards[0].fingerprint, "abc123def4567890abcd");
  assert.equal(result.model.stash.itemCards[0].decoderStatus, "raw-bytes");
  assert.equal(result.model.stash.upgradeCandidates[0].score, 58);
  assert.equal(result.model.stash.upgradeCandidates[0].comparison.status, "comparable-slot");
  assert.equal(result.model.stash.upgradeCandidates[0].comparison.scoreDelta, 18);
  assert.equal(result.metrics.dataQuality.hasStash, true);
  assert.ok(result.issues.some((issue) => issue.id === "unspent-passives"));
  assert.ok(result.issues.some((issue) => issue.id === "survivability-risk"));
  assert.ok(result.recommendations.some((item) => item.id === "spend-passive-points"));
  assert.ok(result.recommendations.some((item) => item.id === "knowledge-scale-primary-damage"));
  assert.ok(result.plan.steps.some((step) => step.id === "decoder"));
  assert.equal(searchStashUpgrades(result.model).length, 1);
});
