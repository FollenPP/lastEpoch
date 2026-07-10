import test from "node:test";
import assert from "node:assert/strict";
import { analyzeFile } from "../src/analyzer.js";
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
        </rules>
      </ItemFilter>
    `),
  );

  assert.equal(result.classification, "filter");
  assert.deepEqual(result.filterStats, {
    name: "My Filter",
    ruleCount: 2,
    showCount: 1,
    hideCount: 1,
    highlightCount: 0,
  });
});

test("generateReviewFilter creates a conservative non-hiding filter", () => {
  const xml = generateReviewFilter({ snapshotId: "20260710-test" });

  assert.match(xml, /<ItemFilter/);
  assert.match(xml, /<type>SHOW<\/type>/);
  assert.doesNotMatch(xml, /<type>HIDE<\/type>/);
});
