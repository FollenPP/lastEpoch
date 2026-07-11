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
          },
          skills: {
            specializedTrees: 3,
            abilityBarSlots: 4,
            abilityCodes: ["fireball", "teleport"],
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
  assert.equal(result.model.stash.upgradeCandidates.length, 1);
  assert.equal(result.metrics.dataQuality.hasStash, true);
  assert.ok(result.issues.some((issue) => issue.id === "unspent-passives"));
  assert.ok(result.issues.some((issue) => issue.id === "survivability-risk"));
  assert.ok(result.recommendations.some((item) => item.id === "spend-passive-points"));
  assert.ok(result.plan.steps.some((step) => step.id === "decoder"));
  assert.equal(searchStashUpgrades(result.model).length, 1);
});
