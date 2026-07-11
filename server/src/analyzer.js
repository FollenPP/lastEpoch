import fs from "node:fs/promises";
import path from "node:path";
import { decodeItemRecord, estimateRawItemScore } from "./item-decoder.js";
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

const PARSED_DATA = Symbol("parsedData");

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
  const game = buildGameModel(fileAnalyses);

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
    game,
    recommendations: buildRecommendations({
      totalFiles: fileAnalyses.length,
      characterFiles,
      stashFiles,
      filterFiles,
      readableFiles,
      jsonFiles,
      itemSignalCount,
      game,
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
  const gameSummary = buildFileGameSummary(file, classification, json, strings, text);

  const result = {
    kind: file.kind,
    relativePath: file.relativePath,
    sourceRoot: file.sourceRoot ?? "",
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
    gameSummary,
  };
  result[PARSED_DATA] = json;
  return result;
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
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) {
      printable += 1;
    }
  }
  return printable / sample.length;
}

function tryParseJson(text) {
  const trimmed = text.trim();
  const candidates = [trimmed];
  if (trimmed.startsWith("EPOCH")) {
    candidates.push(trimmed.slice("EPOCH".length).trim());
  }
  const objectStart = trimmed.indexOf("{");
  const arrayStart = trimmed.indexOf("[");
  for (const start of [objectStart, arrayStart]) {
    if (start > 0) candidates.push(trimmed.slice(start).trim());
  }

  for (const candidate of candidates) {
    if (!candidate.startsWith("{") && !candidate.startsWith("[")) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate. Last Epoch prefixes offline files with EPOCH.
    }
  }
  return null;
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
  const ruleCount = (text.match(/<Rule\b/gi) ?? []).length;
  const showCount = (text.match(/<type>\s*SHOW\s*<\/type>/gi) ?? []).length;
  const hideCount = (text.match(/<type>\s*HIDE\s*<\/type>/gi) ?? []).length;
  const highlightCount = (text.match(/<type>\s*HIGHLIGHT\s*<\/type>/gi) ?? []).length;
  const name = text.match(/<name>([\s\S]*?)<\/name>/i)?.[1] ?? path.basename("filter.xml");
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
    gameSummary: file.gameSummary,
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
      title: "Снимок пустой",
      body: "Decky не отправил файлы. Плагин не нашел Last Epoch в Proton, Steam library, SD-карте или native Linux путях.",
    });
    return recommendations;
  }

  if (context.characterFiles.length === 0) {
    recommendations.push({
      severity: "warning",
      title: "Персонажи не найдены",
      body: "Выгрузка сработала, но файлы персонажей не распознаны. Нужны файлы 1CHARACTERSLOT из Full Offline Saves.",
    });
  }

  if (context.stashFiles.length > 0) {
    recommendations.push({
      severity: "success",
      title: "Сундук найден",
      body: `Найдено ${context.stashFiles.length} файлов сундука. Можно смотреть вкладки, золото, материалы и предметные записи.`,
    });
  } else {
    recommendations.push({
      severity: "info",
      title: "Сундук пока не найден",
      body: "Без STASH_CYCLE файлов советы по замене предметов будут неполными: виден только персонаж, но не весь запас вещей.",
    });
  }

  if (context.filterFiles.length > 0) {
    recommendations.push({
      severity: "success",
      title: "Фильтр добычи загружен",
      body: `Найдено ${context.filterFiles.length} XML-фильтр(ов). Если в фильтре мало правил, стоит начать с безопасного review-фильтра без скрытия предметов.`,
    });
  }

  if (context.readableFiles.length === 0) {
    recommendations.push({
      severity: "info",
      title: "Нужна калибровка парсера",
      body: "Файлы выглядят бинарными или закодированными. Следующий шаг - подобрать декодер под реальные sample-файлы.",
    });
  } else {
    recommendations.push({
      severity: "info",
      title: "Данные читаются",
      body: `Читаемых файлов: ${context.readableFiles.length}. EPOCH/JSON файлов: ${context.jsonFiles.length}.`,
    });
  }

  for (const item of buildGameAdvice(context.game)) {
    recommendations.push(item);
  }

  return recommendations;
}

function buildFileGameSummary(file, classification, data, strings, text) {
  if (classification === "character") return buildCharacterSummary(file, data, strings, text);
  if (classification === "stash") return buildStashSummary(file, data, strings, text);
  if (classification === "filter") return buildFilterSummary(file, data, strings, text);
  return null;
}

function buildCharacterSummary(file, data, strings, text) {
  const source = isObject(data) ? data : {};
  const passiveTree = source.savedCharacterTree ?? {};
  const skillTrees = Array.isArray(source.savedSkillTrees)
    ? source.savedSkillTrees
    : isObject(source.savedSkillTrees)
      ? Object.values(source.savedSkillTrees)
      : [];
  const abilityBar = source.abilityBar ?? {};

  const summary = {
    type: "character",
    name: stringValue(source.characterName) ?? findStringAfter(strings, "characterName") ?? file.name,
    level: numberValue(source.level) ?? numberAfterKey(text, "level"),
    classId: numberValue(source.characterClass),
    hardcore: booleanValue(source.hardcore),
    died: booleanValue(source.died),
    deaths: numberValue(source.deaths),
    currentExp: numberValue(source.currentExp),
    totalPlaytimeHours: playtimeHours(source.totalPlaytimePlayed),
    passiveTree: {
      treeId: numberValue(passiveTree.treeID),
      nodesTaken: countCollection(passiveTree.nodesTaken),
      nodeIds: countCollection(passiveTree.nodeIDs),
      nodePoints: countCollection(passiveTree.nodePoints),
      unspentPoints: numberValue(passiveTree.unspentPoints),
    },
    skills: {
      specializedTrees: skillTrees.length,
      abilityBarSlots: countFilledValues(abilityBar),
      abilityCodes: collectAbilityCodes(abilityBar, strings),
    },
    quests: {
      savedQuests: countCollection(source.savedQuests),
      completedObjectives: countDeepKey(source, "completeObjectives"),
    },
  };
  summary.advice = buildCharacterAdvice(summary);
  return summary;
}

function buildCharacterAdvice(character) {
  const advice = [];
  const level = character.level ?? 0;
  const unspentPoints = character.passiveTree?.unspentPoints ?? 0;
  const specializedTrees = character.skills?.specializedTrees ?? 0;
  const abilityBarSlots = character.skills?.abilityBarSlots ?? 0;

  if (level > 0 && level < 70) {
    advice.push(
      "Прокачка: приоритет не идеальные легендарки, а темп. Держи хороший урон на главном навыке, скорость передвижения на ботинках, здоровье и сопротивления на редких предметах.",
    );
  }

  if (level >= 70) {
    advice.push(
      "Эндгейм: перед заменой предметов сначала проверь защитный минимум: сопротивления, здоровье, endurance/crit avoidance и идолы под основной скейлинг билда.",
    );
  }

  if (unspentPoints > 0) {
    advice.push(`Есть свободные пассивные очки: ${unspentPoints}. Их почти всегда выгоднее потратить сразу, чем ждать идеального маршрута.`);
  }

  if (level >= 50 && specializedTrees > 0 && specializedTrees < 5) {
    advice.push(
      `Специализаций навыков меньше пяти: ${specializedTrees}. Проверь, не пропущен ли защитный, mobility или utility-скилл.`,
    );
  }

  if (abilityBarSlots > 0 && abilityBarSlots < 5) {
    advice.push(`На панели найдено только ${abilityBarSlots} скилла(ов). Если это не ошибка парсинга, стоит заполнить все активные слоты.`);
  }

  if (character.hardcore || character.deaths > 0 || character.died) {
    advice.push(
      "Есть сигнал по выживаемости. Следующая проверка: источники sustain, cleanse/ward/armor, capped resistances и опасные зоны, где уже были смерти.",
    );
  }

  return advice.slice(0, 5);
}

function buildStashSummary(file, data, strings, text) {
  const source = isObject(data) ? data : {};
  const fileName = path.basename(file.relativePath ?? "");
  const isTab = fileName.includes("_TAB_");
  const savedItems = source.savedItems ?? source.savedStashItems ?? [];
  return {
    type: isTab ? "stash-tab" : "stash",
    stashId: fileName.replace(/\.bak$/i, ""),
    displayName: stringValue(source.displayName) ?? findStringAfter(strings, "displayName"),
    stashName: stringValue(source.soloChallengeStashName) ?? findStringAfter(strings, "soloChallengeStashName"),
    cycle: numberValue(source.cycle),
    gold: numberValue(source.gold) ?? numberAfterKey(text, "gold"),
    tabs: countCollection(source.tabsv2 ?? source.tabs),
    savedItems: countCollection(savedItems),
    itemRecords: countDeepKey(source, "itemData"),
    shards: countCollection(source.savedShards),
    materials: countCollection(source.materialsList),
    keys: countCollection(source.keysList),
    categoryId: numberValue(source.categoryId),
  };
}

function buildFilterSummary(file) {
  return {
    type: "filter",
    fileName: file.name,
  };
}

function buildGameModel(files) {
  const activeFiles = files.filter((file) => !file.name.toLowerCase().endsWith(".bak"));
  const characters = activeFiles
    .filter((file) => file.gameSummary?.type === "character" && file.name.startsWith("1CHARACTERSLOT"))
    .map((file) => ({ ...file.gameSummary, file: file.relativePath, size: file.size, updatedAt: file.mtimeMs }));
  const stashFiles = activeFiles
    .filter((file) => file.gameSummary?.type === "stash")
    .map((file) => ({ ...file.gameSummary, file: file.relativePath, size: file.size, updatedAt: file.mtimeMs }));
  const stashTabs = activeFiles
    .filter((file) => file.gameSummary?.type === "stash-tab")
    .map((file) => ({ ...file.gameSummary, file: file.relativePath, size: file.size, updatedAt: file.mtimeMs }));
  const filters = activeFiles
    .filter((file) => file.classification === "filter")
    .map((file) => ({ file: file.relativePath, size: file.size, stats: file.filterStats }));
  const itemCards = buildItemCards(activeFiles);

  return {
    characters,
    stash: {
      files: stashFiles,
      tabs: stashTabs,
      totalGold: stashFiles.reduce((sum, file) => sum + (file.gold ?? 0), 0),
      totalItemRecords: stashFiles.concat(stashTabs).reduce((sum, file) => sum + (file.itemRecords ?? 0), 0),
      namedTabs: stashTabs.filter((tab) => tab.displayName).map((tab) => tab.displayName),
    },
    filters,
    items: {
      cards: itemCards.slice(0, 60),
      totalRecords: itemCards.length,
    },
    build: {
      hasPassiveTreeData: characters.some((item) => item.passiveTree.nodeIds || item.passiveTree.nodesTaken),
      hasSkillTreeData: characters.some((item) => item.skills.specializedTrees || item.skills.abilityBarSlots),
      parserStage: "epoch-json",
    },
  };
}

function buildItemCards(files) {
  const cards = [];
  for (const file of files) {
    if (!file[PARSED_DATA] || !file.gameSummary) continue;
    let recordIndex = 0;
    collectItemRecords(file[PARSED_DATA], (record) => {
      const sourceName = file.gameSummary.displayName ?? file.gameSummary.name ?? file.gameSummary.stashName ?? file.name;
      const decoded = decodeItemRecord(record, {
        source: file.relativePath,
        sourceType: file.gameSummary.type,
        sourceName,
        recordIndex,
      });
      cards.push({
        id: decoded.id,
        source: file.relativePath,
        sourceType: file.gameSummary.type,
        sourceName,
        quantity: decoded.metadata.quantity,
        containerId: decoded.metadata.containerId,
        inventoryPosition: decoded.metadata.inventoryPosition,
        formatVersion: decoded.metadata.formatVersion,
        dataLength: decoded.byteLength,
        fingerprint: decoded.fingerprint,
        decoderStatus: decoded.decoderStatus,
        score: estimateRawItemScore(decoded),
        decoded,
      });
      recordIndex += 1;
    });
  }
  return cards;
}

function collectItemRecords(value, visitor) {
  const nestedItemDataObjects = new WeakSet();
  walk(value, (node) => {
    if (!isObject(node)) return;
    if (isObject(node.itemData)) nestedItemDataObjects.add(node.itemData);
    if (nestedItemDataObjects.has(node)) return;
    const hasNestedItemData = isObject(node.itemData) || Array.isArray(node.itemData?.data);
    const hasDirectItemData = Array.isArray(node.data) && hasItemRecordMetadata(node);
    if (hasNestedItemData || hasDirectItemData) {
      visitor(node);
    }
  });
}

function hasItemRecordMetadata(node) {
  return ["quantity", "containerID", "inventoryPosition", "formatVersion", "baseType", "uniqueID", "id"].some((key) =>
    Object.prototype.hasOwnProperty.call(node, key),
  );
}

function buildGameAdvice(game) {
  if (!game) return [];
  const advice = [];
  const liveCharacters = game.characters.filter((item) => !item.died);
  const hardcoreCharacters = game.characters.filter((item) => item.hardcore);

  if (game.characters.length > 0) {
    advice.push({
      severity: "success",
      title: "Персонажи распознаны",
      body: `Найдено ${game.characters.length} активных персонажа(ей): ${game.characters.map((item) => item.name).join(", ")}.`,
    });
  }

  if (hardcoreCharacters.length > 0) {
    advice.push({
      severity: "warning",
      title: "Есть Hardcore персонаж",
      body: "Для Hardcore в первую очередь проверяй capped resistances, endurance, здоровье и защитные слои; рискованные offensive-only апгрейды лучше откладывать.",
    });
  }

  if (liveCharacters.length > 0 && game.build.hasPassiveTreeData) {
    advice.push({
      severity: "info",
      title: "Дерево прокачки найдено",
      body: "В сейве есть passive/skill tree данные. Сейчас приложение показывает состояние дерева; следующий шаг - сопоставить nodeID с базой Last Epoch и подсвечивать конкретные узлы.",
    });
  }

  if (game.stash.namedTabs.some((name) => /idol/i.test(name))) {
    advice.push({
      severity: "info",
      title: "Идолы вынесены отдельно",
      body: "В сундуке есть вкладка idols. Для билд-советов это полезно: идолы часто дают больше выживаемости/скейлинга, чем случайная замена редкого предмета.",
    });
  }

  if (game.filters.some((filter) => (filter.stats?.ruleCount ?? 0) === 0)) {
    advice.push({
      severity: "warning",
      title: "Фильтр почти пустой",
      body: "Загруженный loot filter не содержит правил. Лучше сгенерировать review-фильтр: он ничего не скрывает, но подсвечивает кандидатов для ручной проверки.",
    });
  }

  if (game.items.totalRecords > 0) {
    advice.push({
      severity: "success",
      title: "Предметные записи найдены",
      body: `Найдено ${game.items.totalRecords} записей предметов в персонажах/сундуке. Пока это технические карточки; после маппинга itemData появятся названия баз, аффиксы и сравнение апгрейдов.`,
    });
  }

  return advice;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function booleanValue(value) {
  return typeof value === "boolean" ? value : null;
}

function playtimeHours(value) {
  const seconds = numberValue(value);
  return seconds === null ? null : Number((seconds / 3600).toFixed(1));
}

function countCollection(value) {
  if (Array.isArray(value)) return value.length;
  if (isObject(value)) return Object.keys(value).length;
  return 0;
}

function countFilledValues(value) {
  if (!isObject(value) && !Array.isArray(value)) return 0;
  return Object.values(value).filter((item) => item !== null && item !== undefined && item !== "" && item !== 0).length;
}

function countDeepKey(value, key) {
  let count = 0;
  walk(value, (node) => {
    if (isObject(node) && Object.prototype.hasOwnProperty.call(node, key)) count += 1;
  });
  return count;
}

function walk(value, visitor) {
  visitor(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visitor);
  } else if (isObject(value)) {
    for (const item of Object.values(value)) walk(item, visitor);
  }
}

function findStringAfter(strings, key) {
  const index = strings.indexOf(key);
  if (index < 0) return null;
  for (const value of strings.slice(index + 1, index + 6)) {
    if (!value.startsWith(":") && value !== "null") return value;
  }
  return null;
}

function numberAfterKey(text, key) {
  const index = text.indexOf(key);
  if (index < 0) return null;
  const match = text.slice(index, index + 120).match(/:\s*(-?\d+(?:\.\d+)?)/);
  return match ? numberValue(match[1]) : null;
}

function collectAbilityCodes(abilityBar, strings) {
  const codes = new Set();
  if (isObject(abilityBar) || Array.isArray(abilityBar)) {
    for (const value of Object.values(abilityBar)) {
      if (typeof value === "string" && value.trim()) codes.add(value.trim());
    }
  }
  if (codes.size > 0) return Array.from(codes).slice(0, 8);

  const abilityIndex = strings.indexOf("abilityBar");
  if (abilityIndex >= 0) {
    for (const value of strings.slice(abilityIndex + 1, abilityIndex + 8)) {
      if (/^[a-z0-9]{3,}$/i.test(value)) codes.add(value);
    }
  }
  return Array.from(codes).slice(0, 8);
}

function summarizePosition(value) {
  if (Array.isArray(value)) return value.slice(0, 3).join(", ");
  if (isObject(value)) return Object.values(value).slice(0, 3).join(", ");
  return value === undefined || value === null ? "" : String(value);
}
