import fs from "node:fs/promises";
import path from "node:path";
import { safeJoin } from "./storage.js";

const ITEM_SIGNAL_WORDS = [
  "affix",
  "implicit",
  "prefix",
  "suffix",
  "unique",
  "set",
  "exalted",
  "legendary",
  "idol",
  "resistance",
  "health",
  "critical",
  "endurance",
  "minion",
  "necrotic",
  "void",
  "fire",
  "cold",
  "lightning",
  "poison",
  "physical",
];

export async function analyzeSnapshot(manifest, rawDir) {
  const fileAnalyses = [];
  for (const file of manifest.files ?? []) {
    const absolutePath = safeJoin(rawDir, file.relativePath);
    const buffer = await fs.readFile(absolutePath);
    fileAnalyses.push(analyzeFile(file, buffer));
  }

  const characterFiles = fileAnalyses.filter((file) => file.classification === "character");
  const stashFiles = fileAnalyses.filter((file) => file.classification === "stash");
  const filterFiles = fileAnalyses.filter((file) => file.classification === "filter");
  const readableFiles = fileAnalyses.filter((file) => file.readable);
  const jsonFiles = fileAnalyses.filter((file) => file.json);
  const itemSignalCount = fileAnalyses.reduce((sum, file) => sum + file.itemSignalCount, 0);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalFiles: fileAnalyses.length,
      characterFiles: characterFiles.length,
      stashFiles: stashFiles.length,
      filterFiles: filterFiles.length,
      readableFiles: readableFiles.length,
      jsonFiles: jsonFiles.length,
      itemSignalCount,
      parserCoverage: fileAnalyses.length === 0 ? 0 : Math.round((readableFiles.length / fileAnalyses.length) * 100),
    },
    files: fileAnalyses,
    characters: characterFiles.map(toCandidate),
    stashTabs: stashFiles.map(toCandidate),
    filters: filterFiles.map(toFilterCandidate),
    recommendations: buildRecommendations({
      totalFiles: fileAnalyses.length,
      characterFiles,
      stashFiles,
      filterFiles,
      readableFiles,
      jsonFiles,
      itemSignalCount,
    }),
  };
}

export function analyzeFile(file, buffer) {
  const classification = classifyFile(file);
  const text = buffer.toString("utf8");
  const printableRatio = calculatePrintableRatio(text);
  const readable = printableRatio > 0.82;
  const json = readable ? tryParseJson(text) : null;
  const strings = readable ? extractStrings(text).slice(0, 80) : [];
  const itemSignalCount = readable ? countSignals(text) : 0;
  const filterStats = classification === "filter" && readable ? analyzeFilterXml(text) : null;

  return {
    kind: file.kind,
    relativePath: file.relativePath,
    name: path.basename(file.relativePath),
    size: file.size,
    mtimeMs: file.mtimeMs,
    sha256: file.sha256,
    classification,
    readable,
    printableRatio: Number(printableRatio.toFixed(3)),
    json: json
      ? {
          rootType: Array.isArray(json) ? "array" : typeof json,
          topLevelKeys: Array.isArray(json) ? [] : Object.keys(json).slice(0, 40),
        }
      : null,
    stringPreview: strings,
    itemSignalCount,
    filterStats,
  };
}

function classifyFile(file) {
  const name = path.basename(file.relativePath).toLowerCase();
  if (file.kind === "filter" || name.endsWith(".xml")) return "filter";
  if (name.startsWith("stash") || name.includes("stash_cycle")) return "stash";
  if (name.endsWith(".bak") || name.includes("backup")) return "backup";
  if (file.kind === "save") return "character";
  return "other";
}

function calculatePrintableRatio(text) {
  if (!text.length) return 1;
  let printable = 0;
  const sample = text.slice(0, 200_000);
  for (const char of sample) {
    const code = char.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code < 127)) {
      printable += 1;
    }
  }
  return printable / sample.length;
}

function tryParseJson(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function extractStrings(text) {
  const matches = text.match(/[A-Za-z0-9_ .:+\-/%'()[\]]{4,}/g) ?? [];
  return Array.from(new Set(matches.map((value) => value.trim()).filter(Boolean)));
}

function countSignals(text) {
  const lower = text.toLowerCase();
  return ITEM_SIGNAL_WORDS.reduce((sum, word) => {
    const matches = lower.match(new RegExp(`\\b${word}\\b`, "g"));
    return sum + (matches?.length ?? 0);
  }, 0);
}

function analyzeFilterXml(text) {
  const ruleCount = (text.match(/<Rule>/g) ?? []).length;
  const showCount = (text.match(/<type>SHOW<\/type>/g) ?? []).length;
  const hideCount = (text.match(/<type>HIDE<\/type>/g) ?? []).length;
  const highlightCount = (text.match(/<type>HIGHLIGHT<\/type>/g) ?? []).length;
  const name = text.match(/<name>(.*?)<\/name>/)?.[1] ?? path.basename("filter.xml");
  return {
    name: decodeXmlText(name),
    ruleCount,
    showCount,
    hideCount,
    highlightCount,
  };
}

function decodeXmlText(value) {
  return String(value)
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'");
}

function toCandidate(file) {
  return {
    relativePath: file.relativePath,
    name: file.name,
    size: file.size,
    readable: file.readable,
    json: file.json,
    itemSignalCount: file.itemSignalCount,
    stringPreview: file.stringPreview.slice(0, 20),
  };
}

function toFilterCandidate(file) {
  return {
    relativePath: file.relativePath,
    name: file.name,
    size: file.size,
    readable: file.readable,
    stats: file.filterStats,
  };
}

function buildRecommendations(context) {
  const recommendations = [];

  if (context.totalFiles === 0) {
    recommendations.push({
      severity: "warning",
      title: "Snapshot is empty",
      body: "Decky did not send any files. Check the Last Epoch save and filter paths in plugin settings.",
    });
    return recommendations;
  }

  if (context.characterFiles.length === 0) {
    recommendations.push({
      severity: "warning",
      title: "No character files detected",
      body: "The upload worked, but no likely offline character files were found. Verify that the plugin points at the Full Offline Saves folder.",
    });
  }

  if (context.stashFiles.length > 0) {
    recommendations.push({
      severity: "success",
      title: "Stash files are available",
      body: `Detected ${context.stashFiles.length} likely stash file(s). The next parser pass can decode item records from these files and compare upgrades across tabs.`,
    });
  } else {
    recommendations.push({
      severity: "info",
      title: "No stash files detected yet",
      body: "The analyzer can still inspect character files, but full upgrade advice needs STASH_CYCLE files from the Saves folder.",
    });
  }

  if (context.filterFiles.length > 0) {
    recommendations.push({
      severity: "success",
      title: "Loot filters uploaded",
      body: `Detected ${context.filterFiles.length} filter file(s). The app can compare future generated filters against your existing setup.`,
    });
  }

  if (context.readableFiles.length === 0) {
    recommendations.push({
      severity: "info",
      title: "Parser calibration needed",
      body: "The files look binary or encoded. That is fine for an MVP snapshot: the next step is calibrating a decoder against real sample files.",
    });
  } else {
    recommendations.push({
      severity: "info",
      title: "Readable data found",
      body: `Detected ${context.readableFiles.length} readable file(s), including ${context.jsonFiles.length} JSON-like file(s) and ${context.itemSignalCount} item-related text signal(s).`,
    });
  }

  return recommendations;
}
