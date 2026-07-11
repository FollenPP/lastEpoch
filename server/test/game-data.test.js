import test from "node:test";
import assert from "node:assert/strict";
import { buildKnowledgeProfile, summarizeGameData } from "../src/game-data.js";

test("summarizeGameData exposes starter knowledge coverage", () => {
  const summary = summarizeGameData();

  assert.equal(summary.status, "starter");
  assert.ok(summary.coverage.skillTokenRules > 0);
  assert.equal(summary.coverage.exactAffixes, 0);
});

test("buildKnowledgeProfile infers fire caster priorities from skill signals", () => {
  const profile = buildKnowledgeProfile(
    {
      name: "AdletM",
      level: 72,
      hardcore: true,
      deaths: 0,
      classId: 2,
      masteryId: null,
      passiveTree: { hasData: true },
      skills: {
        abilityCodes: ["fireball", "teleport"],
      },
    },
    {
      stash: {
        namedTabs: ["idols", "exalted"],
        tabs: [],
      },
    },
  );

  assert.equal(profile.phase, "endgame");
  assert.equal(profile.archetype.primary, "hit-caster");
  assert.ok(profile.tags.damage.includes("fire"));
  assert.ok(profile.tags.utility.includes("movement"));
  assert.ok(profile.tags.stash.includes("idols"));
  assert.ok(profile.priorities.some((item) => item.id === "scale-primary-damage"));
  assert.ok(profile.priorities.some((item) => item.id === "review-idols"));
  assert.ok(profile.confidence >= 0.7);
});
