import { buildKnowledgeProfile, summarizeGameData } from "./game-data.js";

const ANALYSIS_VERSION = "build-analyzer-mvp-1";

export function buildAnalyzerSnapshot(snapshot, analysis) {
  const model = normalizeBuildModel(snapshot, analysis);
  const metrics = calculateMetrics(model);
  const issues = detectIssues(model, metrics);
  const recommendations = rankRecommendations(model, metrics, issues);
  const plan = buildDevelopmentPlan(model, metrics, issues, recommendations);
  const breakdown = buildBreakdown(model, metrics, issues);

  return {
    id: snapshot.id,
    analysisId: snapshot.id,
    version: ANALYSIS_VERSION,
    generatedAt: new Date().toISOString(),
    snapshotId: snapshot.id,
    model,
    metrics,
    issues,
    recommendations,
    plan,
    breakdown,
    limitations: [
      "itemData пока не сопоставлен с базой предметов Last Epoch, поэтому предметные рекомендации имеют низкую уверенность.",
      "Game-data слой сейчас стартовый: он определяет теги и приоритеты, но не заменяет полный datamine предметов, пассивок и формул.",
      "Пассивные и skill node ID пока отображаются как технические идентификаторы без названий узлов.",
      "Расчет характеристик сейчас эвристический; полноценный formula engine будет отдельным следующим модулем.",
    ],
  };
}

export function normalizeBuildModel(snapshot, analysis) {
  const game = analysis?.game ?? {};
  const baseCharacters = (game.characters ?? []).map((character, index) => normalizeCharacter(character, snapshot, index));
  const stash = normalizeStash(game.stash ?? {}, game.items ?? {});
  const filters = normalizeFilters(game.filters ?? []);
  const characters = attachEquipmentToCharacters(baseCharacters, stash.itemCards);
  const activeCharacter = chooseActiveCharacter(characters);
  stash.upgradeCandidates = buildUpgradeCandidates(stash.itemCards, activeCharacter);
  const knowledge = buildKnowledgeProfile(activeCharacter, { stash, filters });

  return {
    schemaVersion: "le-build-model-v1",
    snapshot: {
      id: snapshot.id,
      createdAt: snapshot.createdAt,
      receivedAt: snapshot.receivedAt,
      source: snapshot.source ?? null,
      deckName: snapshot.deckName ?? null,
      pluginVersion: snapshot.pluginVersion ?? null,
      fileCount: snapshot.fileCount ?? 0,
    },
    activeCharacterId: activeCharacter?.id ?? null,
    characters,
    stash,
    filters,
    gameData: summarizeGameData(),
    knowledge,
    parser: {
      stage: game.build?.parserStage ?? "unknown",
      hasPassiveTreeData: Boolean(game.build?.hasPassiveTreeData),
      hasSkillTreeData: Boolean(game.build?.hasSkillTreeData),
      itemRecordCount: game.items?.totalRecords ?? 0,
      coverage: analysis?.summary?.parserCoverage ?? 0,
    },
    importSummary: analysis?.summary ?? {},
  };
}

export function calculateMetrics(model) {
  const active = model.characters.find((character) => character.id === model.activeCharacterId) ?? model.characters[0] ?? null;
  const parseCompleteness = scoreParseCompleteness(model, active);
  const progressionReadiness = scoreProgression(active);
  const defensiveReadiness = scoreDefense(active);
  const skillReadiness = scoreSkills(active);
  const knowledgeReadiness = scoreKnowledge(model.knowledge);
  const stashReadiness = Math.min(100, Math.round((model.stash.itemRecordCount / 20) * 100));
  const filterReadiness = model.filters.length === 0 ? 0 : Math.min(100, Math.max(...model.filters.map((filter) => filter.ruleCount * 10)));
  const confidence = Math.round((parseCompleteness + progressionReadiness + defensiveReadiness + skillReadiness + knowledgeReadiness) / 5);

  return {
    activeCharacterId: active?.id ?? null,
    parseCompleteness,
    confidence,
    progressionReadiness,
    defensiveReadiness,
    skillReadiness,
    knowledgeReadiness,
    stashReadiness,
    filterReadiness,
    dataQuality: {
      hasCharacter: model.characters.length > 0,
      hasStash: model.stash.fileCount + model.stash.tabs.length > 0,
      hasItems: model.stash.itemRecordCount > 0,
      hasFilters: model.filters.length > 0,
      hasPassiveTree: Boolean(active?.passiveTree.hasData),
      hasSkillTrees: Boolean(active?.skills.hasData),
      hasGameData: model.gameData?.status === "starter",
      hasArchetype: Boolean(model.knowledge?.archetype?.primary && model.knowledge.archetype.primary !== "unknown"),
      hasEquipment: (active?.equipment?.equippedItems?.length ?? 0) > 0,
      hasDecodedItems: model.stash.itemCards.some((item) => item.gameItem) || model.characters.some((character) => character.equipment.equippedItems.some((item) => item.gameItem)),
    },
  };
}

export function detectIssues(model, metrics) {
  const active = model.characters.find((character) => character.id === model.activeCharacterId) ?? null;
  const issues = [];

  if (!active) {
    issues.push(issue("missing-character", "critical", "Персонаж не найден", "В снимке нет распознанного 1CHARACTERSLOT файла.", 100));
    return issues;
  }

  if (!active.passiveTree.hasData) {
    issues.push(
      issue(
        "passive-tree-unmapped",
        "warning",
        "Дерево пассивок не распознано полностью",
        "Система видит персонажа, но не видит достаточно данных passive tree для точной оптимизации узлов.",
        85,
      ),
    );
  }

  if (active.passiveTree.unspentPoints > 0) {
    issues.push(
      issue(
        "unspent-passives",
        "warning",
        "Есть свободные пассивные очки",
        `Не потрачено пассивных очков: ${active.passiveTree.unspentPoints}. Это прямой потерянный power budget.`,
        90,
      ),
    );
  }

  if (active.level >= 50 && active.skills.specializedTrees > 0 && active.skills.specializedTrees < 5) {
    issues.push(
      issue(
        "missing-skill-specializations",
        "warning",
        "Не все специализации навыков заполнены",
        `Найдено специализаций: ${active.skills.specializedTrees}. Для поздней прокачки обычно нужно 5 специализированных навыков.`,
        72,
      ),
    );
  }

  if (active.skills.abilityBarSlots > 0 && active.skills.abilityBarSlots < 5) {
    issues.push(
      issue(
        "incomplete-ability-bar",
        "info",
        "Панель навыков выглядит неполной",
        `На панели найдено ${active.skills.abilityBarSlots} активных слота. Если это не ошибка парсинга, стоит заполнить панель.`,
        55,
      ),
    );
  }

  if (active.hardcore || active.deaths > 0 || active.died) {
    issues.push(
      issue(
        "survivability-risk",
        active.hardcore ? "critical" : "warning",
        "Есть риск по выживаемости",
        "Hardcore/смерти требуют сначала проверять здоровье, сопротивления, endurance, sustain и защитные слои.",
        active.hardcore ? 95 : 80,
      ),
    );
  }

  if ((model.knowledge?.confidence ?? 0) < 0.4) {
    issues.push(
      issue(
        "archetype-uncertain",
        "info",
        "Архетип билда пока распознан слабо",
        "Game-data слой не нашел достаточно skill/tag сигналов. Рекомендации по урону будут осторожными, пока не появится больше данных о skill bar, passive tree и предметах.",
        58,
      ),
    );
  }

  if (!metrics.dataQuality.hasStash) {
    issues.push(
      issue(
        "stash-missing",
        "info",
        "Stash не загружен",
        "Без stash система не может искать реальные улучшения среди доступных предметов.",
        65,
      ),
    );
  }

  if (metrics.dataQuality.hasItems && !metrics.dataQuality.hasDecodedItems) {
    issues.push(
      issue(
        "items-undecoded",
        "info",
        "Предметы пока не расшифрованы",
        "itemData найден, но без базы предметов нельзя назвать affix/base и точно посчитать апгрейд.",
        70,
      ),
    );
  }

  if (metrics.dataQuality.hasItems && !metrics.dataQuality.hasEquipment) {
    issues.push(
      issue(
        "equipment-baseline-missing",
        "info",
        "Надетая экипировка пока не отделена от инвентаря",
        "Предметные записи найдены, но система не смогла уверенно определить equipped slots. Сравнение stash-кандидатов будет без baseline-предмета.",
        57,
      ),
    );
  }

  if (!metrics.dataQuality.hasFilters) {
    issues.push(
      issue(
        "loot-filter-missing",
        "info",
        "Loot-фильтр не найден",
        "Без фильтра сложнее поддерживать прокачку: игра будет показывать слишком много нерелевантной добычи.",
        45,
      ),
    );
  }

  return issues.sort((a, b) => b.priority - a.priority);
}

export function rankRecommendations(model, metrics, issues) {
  const recommendations = [];
  const active = model.characters.find((character) => character.id === model.activeCharacterId) ?? null;

  for (const currentIssue of issues) {
    if (currentIssue.id === "unspent-passives") {
      recommendations.push(
        recommendation({
          id: "spend-passive-points",
          title: "Потратить свободные пассивные очки",
          action: "Открой дерево пассивок и вложи свободные очки в живучесть, основной тип урона или путь к mastery-узлам.",
          reason: currentIssue.body,
          expectedEffect: "+прямой прирост силы без замены предметов",
          confidence: 0.78,
          priority: 95,
          issueIds: [currentIssue.id],
        }),
      );
    }

    if (currentIssue.id === "survivability-risk") {
      recommendations.push(
        recommendation({
          id: "stabilize-defenses",
          title: "Сначала стабилизировать защиту",
          action: "Проверь здоровье, capped resistances, endurance, armor/ward и источники sustain перед заменой предметов на урон.",
          reason: currentIssue.body,
          expectedEffect: "меньше смертей и стабильнее monolith/кампания",
          confidence: active?.hardcore ? 0.86 : 0.7,
          priority: active?.hardcore ? 100 : 82,
          issueIds: [currentIssue.id],
        }),
      );
    }

    if (currentIssue.id === "missing-skill-specializations") {
      recommendations.push(
        recommendation({
          id: "fill-skill-specializations",
          title: "Довести специализации навыков до пяти",
          action: "Добавь недостающие skill specialization: основной урон, movement, defensive cooldown, utility/cleanse и secondary damage.",
          reason: currentIssue.body,
          expectedEffect: "+комфорт и меньше провалов в защите/мобильности",
          confidence: 0.74,
          priority: 78,
          issueIds: [currentIssue.id],
        }),
      );
    }

    if (currentIssue.id === "stash-missing") {
      recommendations.push(
        recommendation({
          id: "sync-stash",
          title: "Синхронизировать stash через Decky",
          action: "На Steam Deck нажми Scan Local Files и Send Snapshot, чтобы сервер получил STASH_CYCLE файлы.",
          reason: currentIssue.body,
          expectedEffect: "появится поиск доступных улучшений без ручного ввода",
          confidence: 0.92,
          priority: 70,
          issueIds: [currentIssue.id],
        }),
      );
    }

    if (currentIssue.id === "items-undecoded") {
      recommendations.push(
        recommendation({
          id: "decode-item-data",
          title: "Подключить расшифровку itemData",
          action: "Следующий технический шаг: расширить базу item bases/affixes и декодер itemData.",
          reason: currentIssue.body,
          expectedEffect: "карточки предметов станут игровыми: база, аффиксы, тиры, сравнение",
          confidence: 0.95,
          priority: 88,
          issueIds: [currentIssue.id],
        }),
      );
    }
  }

  if (model.stash.upgradeCandidates.length > 0) {
    recommendations.push(
      recommendation({
        id: "review-stash-candidates",
        title: "Просмотреть кандидатов из stash",
        action: "Открой раздел stash upgrades и проверь предметы с наибольшим score.",
        reason: "В stash найдены itemData записи, которые можно использовать для будущего сравнения.",
        expectedEffect: "быстрее найти предметы, которые стоит расшифровать первыми",
        confidence: 0.45,
        priority: 62,
        issueIds: [],
      }),
    );
  }

  for (const priority of model.knowledge?.priorities ?? []) {
    recommendations.push(
      recommendation({
        id: `knowledge-${priority.id}`,
        title: priority.title,
        action: priority.action,
        reason: priority.reason,
        expectedEffect: priority.expectedEffect,
        confidence: priority.confidence,
        priority: priority.priority,
        issueIds: [],
      }),
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(
      recommendation({
        id: "continue-progression",
        title: "Продолжать прокачку и копить данные",
        action: "Сделай новый snapshot после нескольких уровней или заметной замены предметов.",
        reason: "Критичных проблем по доступным данным не найдено.",
        expectedEffect: "система сможет сравнить историю и увидеть реальные изменения",
        confidence: metrics.confidence / 100,
        priority: 40,
        issueIds: [],
      }),
    );
  }

  return recommendations.sort((a, b) => b.priority - a.priority);
}

export function buildDevelopmentPlan(model, metrics, issues, recommendations) {
  const active = model.characters.find((character) => character.id === model.activeCharacterId) ?? null;
  const level = active?.level ?? 0;
  const steps = [];

  steps.push(planStep("sync", "Обновить данные", "Сделай свежий snapshot через Decky перед принятием решений.", "now"));

  if (issues.some((item) => item.id === "unspent-passives")) {
    steps.push(planStep("passives", "Закрыть свободные passive points", "Потрать свободные очки до сравнения экипировки.", "now"));
  }

  if (issues.some((item) => item.id === "survivability-risk")) {
    steps.push(planStep("defense", "Проверить защитный минимум", "Сначала здоровье, сопротивления, endurance/armor/ward/sustain.", "now"));
  }

  if (level > 0 && level < 70) {
    steps.push(planStep("leveling", "Держать темп прокачки", "Не гоняться за идеальными легендарками; приоритет урон главного навыка и скорость.", "next"));
  } else if (level >= 70) {
    steps.push(planStep("monolith", "Готовить эндгейм-проверку", "После декодера предметов сравнить stash с надетыми слотами и blessings.", "next"));
  }

  for (const priority of model.knowledge?.priorities?.slice(0, 2) ?? []) {
    steps.push(planStep(`knowledge-${priority.id}`, priority.title, priority.action, priority.id === "defensive-floor" ? "now" : "next"));
  }

  if (recommendations.some((item) => item.id === "decode-item-data")) {
    steps.push(planStep("decoder", "Расшифровать itemData", "Расширить game data базу и декодер предметов: base, affixes, tiers, implicits.", "technical"));
  }

  if (!metrics.dataQuality.hasFilters) {
    steps.push(planStep("filter", "Сгенерировать review loot-фильтр", "Создать безопасный фильтр, который ничего не скрывает, но подсвечивает кандидатов.", "next"));
  }

  return {
    activeCharacterId: active?.id ?? null,
    horizon: level >= 70 ? "endgame" : "leveling",
    steps,
  };
}

export function searchStashUpgrades(model) {
  return model.stash.upgradeCandidates;
}

function normalizeCharacter(character, snapshot, index) {
  const id = stableId("character", snapshot.id, character.file ?? index);
  const passiveNodeCount = numberValue(character.passiveTree?.nodeIds) || numberValue(character.passiveTree?.nodesTaken) || 0;
  const skillTrees = normalizeSkillTrees(character.skills?.trees);
  const skillTreeCount = numberValue(character.skills?.specializedTrees) || skillTrees.length || 0;
  const abilityBarSlots = numberValue(character.skills?.abilityBarSlots) || 0;
  const passiveNodeIdsList = arrayValue(character.passiveTree?.nodeIdsList);
  const passiveNodePointsList = arrayValue(character.passiveTree?.nodePointsList);
  const passiveNodesTakenList = arrayValue(character.passiveTree?.nodesTakenList);

  return {
    id,
    sourceFile: character.file ?? null,
    name: character.name ?? `Персонаж ${index + 1}`,
    level: numberValue(character.level) ?? 0,
    classId: numberValue(character.classId),
    masteryId: numberValue(character.masteryId),
    hardcore: Boolean(character.hardcore),
    died: Boolean(character.died),
    deaths: numberValue(character.deaths) ?? 0,
    playtimeHours: numberValue(character.totalPlaytimeHours),
    progression: {
      currentExp: numberValue(character.currentExp),
      savedQuests: numberValue(character.quests?.savedQuests) ?? 0,
      completedObjectives: numberValue(character.quests?.completedObjectives) ?? 0,
    },
    passiveTree: {
      treeId: numberValue(character.passiveTree?.treeId),
      nodes: passiveNodeCount,
      nodePoints: numberValue(character.passiveTree?.nodePoints) ?? 0,
      unspentPoints: numberValue(character.passiveTree?.unspentPoints) ?? 0,
      nodeIdsList: passiveNodeIdsList,
      nodePointsList: passiveNodePointsList,
      nodesTakenList: passiveNodesTakenList,
      hasData:
        passiveNodeCount > 0 ||
        (numberValue(character.passiveTree?.nodePoints) ?? 0) > 0 ||
        passiveNodeIdsList.length > 0 ||
        passiveNodesTakenList.length > 0,
    },
    skills: {
      specializedTrees: skillTreeCount,
      abilityBarSlots,
      abilityCodes: arrayValue(character.skills?.abilityCodes),
      abilitySlots: normalizeAbilitySlots(character.skills?.abilitySlots, character.skills?.abilityCodes),
      trees: skillTrees,
      hasData: skillTreeCount > 0 || abilityBarSlots > 0 || skillTrees.length > 0,
    },
    equipment: {
      decodedItems: 0,
      rawItemRecords: 0,
      equippedItems: [],
      inventoryItems: [],
      slots: {},
      status: "pending-item-decoder",
    },
    advice: character.advice ?? [],
  };
}

function normalizeStash(stash, items) {
  const tabs = (stash.tabs ?? []).map((tab, index) => ({
    id: stableId("stash-tab", tab.file ?? tab.stashId ?? index),
    file: tab.file ?? null,
    name: tab.displayName || tab.stashId || `Вкладка ${index + 1}`,
    categoryId: numberValue(tab.categoryId),
    itemRecords: numberValue(tab.itemRecords || tab.savedItems) ?? 0,
    size: numberValue(tab.size) ?? 0,
  }));
  const files = (stash.files ?? []).map((file, index) => ({
    id: stableId("stash", file.file ?? file.stashId ?? index),
    file: file.file ?? null,
    name: file.stashName || file.stashId || `Сундук ${index + 1}`,
    gold: numberValue(file.gold) ?? 0,
    tabs: numberValue(file.tabs) ?? 0,
    materials: numberValue(file.materials) ?? 0,
    keys: numberValue(file.keys) ?? 0,
    itemRecords: numberValue(file.itemRecords || file.savedItems) ?? 0,
  }));
  const rawCards = items.cards ?? [];
  const itemCards = rawCards.map((item, index) => normalizeItemCard(item, index));
  const totalItemRecords = numberValue(stash.totalItemRecords);
  const itemRecordCount =
    totalItemRecords && totalItemRecords > 0 ? totalItemRecords : (numberValue(items.totalRecords) ?? itemCards.length);

  return {
    files,
    tabs,
    itemCards,
    upgradeCandidates: buildUpgradeCandidates(itemCards, null),
    fileCount: files.length,
    tabCount: tabs.length,
    totalGold: numberValue(stash.totalGold) ?? 0,
    itemRecordCount,
    namedTabs: stash.namedTabs ?? [],
  };
}

function attachEquipmentToCharacters(characters, itemCards) {
  return characters.map((character) => ({
    ...character,
    equipment: buildEquipmentModel(character, itemCards),
  }));
}

function buildEquipmentModel(character, itemCards) {
  const relatedItems = itemCards.filter((item) => item.sourceType === "character" && item.source === character.sourceFile);
  const equippedItems = relatedItems.filter((item) => item.locationType === "equipped" || Boolean(item.equipmentSlot));
  const inventoryItems = relatedItems.filter((item) => item.locationType === "inventory" || item.locationType === "character");
  const slots = {};
  const slotCounts = {};
  for (const item of equippedItems) {
    const slot = item.equipmentSlot ?? item.itemKind ?? "unknown";
    const slotIndex = slotCounts[slot] ?? 0;
    const displaySlot = displaySlotKey(slot, slotIndex);
    slotCounts[slot] = slotIndex + 1;
    if (!slots[displaySlot] || estimateItemScore(item) > estimateItemScore(slots[displaySlot])) {
      slots[displaySlot] = item;
    }
  }

  return {
    decodedItems: equippedItems.filter((item) => item.gameItem || item.decoderStatus === "decoded-item").length,
    rawItemRecords: relatedItems.length,
    equippedItems,
    inventoryItems,
    slots,
    status:
      equippedItems.length > 0
        ? "equipment-detected"
        : relatedItems.length > 0
          ? "character-items-without-slots"
          : "no-character-item-records",
  };
}

function displaySlotKey(slot, index) {
  if (slot === "ring" && index === 1) return "ring2";
  if (slot === "ring" && index > 1) return `ring${index + 1}`;
  if (slot === "idol" && index > 0) return `idol${index + 1}`;
  return slot;
}

function buildUpgradeCandidates(itemCards, activeCharacter) {
  return itemCards
    .filter((item) => item.sourceType === "stash" || item.sourceType === "stash-tab")
    .map((item) => {
      const comparison = compareWithEquipped(item, activeCharacter?.equipment);
      return {
        ...item,
        score: estimateItemScore(item),
        confidence: comparison.status === "comparable-slot" ? "medium-low" : "low",
        comparison,
        reason: comparison.reason,
      };
    })
    .sort((a, b) => {
      const deltaA = numberValue(a.comparison?.scoreDelta) ?? -999;
      const deltaB = numberValue(b.comparison?.scoreDelta) ?? -999;
      if (deltaA !== deltaB) return deltaB - deltaA;
      return b.score - a.score;
    })
    .slice(0, 20);
}

function compareWithEquipped(candidate, equipment) {
  const candidateScore = estimateItemScore(candidate);
  const baseline = findComparableEquippedItem(candidate, equipment);
  const slot = candidate.equipmentSlot ?? candidate.itemKind ?? baseline?.equipmentSlot ?? baseline?.itemKind ?? null;

  if (!equipment || (equipment.equippedItems ?? []).length === 0) {
    return {
      status: "no-equipped-baseline",
      slot,
      baselineItemId: null,
      baselineScore: null,
      candidateScore,
      scoreDelta: null,
      reason: "Кандидат из stash найден, но baseline экипировки пока не распознан.",
    };
  }

  if (!baseline) {
    return {
      status: "no-slot-match",
      slot,
      baselineItemId: null,
      baselineScore: null,
      candidateScore,
      scoreDelta: null,
      reason: "Кандидат из stash найден, но слот не удалось сопоставить с надетым предметом.",
    };
  }

  const baselineScore = estimateItemScore(baseline);
  const scoreDelta = candidateScore - baselineScore;
  return {
    status: "comparable-slot",
    slot,
    baselineItemId: baseline.id,
    baselineFingerprint: baseline.fingerprint,
    baselineScore,
    candidateScore,
    scoreDelta,
    reason:
      scoreDelta >= 0
        ? `Кандидат для слота ${slot ?? "unknown"} имеет raw score выше baseline на ${scoreDelta}.`
        : `Кандидат для слота ${slot ?? "unknown"} ниже baseline по raw score на ${Math.abs(scoreDelta)}; проверить вручную.`,
  };
}

function findComparableEquippedItem(candidate, equipment) {
  const equippedItems = equipment?.equippedItems ?? [];
  if (!equippedItems.length) return null;
  const candidateSlot = candidate.equipmentSlot ?? null;
  const candidateKind = candidate.itemKind ?? null;
  return (
    equippedItems.find((item) => candidateSlot && item.equipmentSlot === candidateSlot) ??
    equippedItems.find((item) => candidateKind && item.itemKind === candidateKind) ??
    null
  );
}

function normalizeFilters(filters) {
  return filters.map((filter, index) => ({
    id: stableId("filter", filter.file ?? index),
    file: filter.file ?? null,
    name: filter.stats?.name ?? `Фильтр ${index + 1}`,
    ruleCount: numberValue(filter.stats?.ruleCount) ?? 0,
    showCount: numberValue(filter.stats?.showCount) ?? 0,
    hideCount: numberValue(filter.stats?.hideCount) ?? 0,
    highlightCount: numberValue(filter.stats?.highlightCount) ?? 0,
  }));
}

function normalizeItemCard(item, index) {
  const decoded = isPlainObject(item.decoded) ? item.decoded : null;
  const gameItem = isPlainObject(item.gameItem) ? item.gameItem : isPlainObject(decoded?.gameItem) ? decoded.gameItem : null;
  const fingerprint = item.fingerprint ?? decoded?.fingerprint ?? null;
  const dataLength = numberValue(item.dataLength) ?? numberValue(decoded?.byteLength) ?? 0;
  const score = numberValue(item.score);
  return {
    id: item.id ?? stableId("item", fingerprint ?? item.source ?? "", index, item.inventoryPosition ?? ""),
    source: item.source ?? null,
    sourceType: item.sourceType ?? "unknown",
    sourceName: item.sourceName ?? null,
    quantity: numberValue(item.quantity),
    containerId: numberValue(item.containerId),
    inventoryPosition: item.inventoryPosition ?? "",
    formatVersion: numberValue(item.formatVersion),
    dataLength,
    fingerprint,
    recordPath: item.recordPath ?? decoded?.metadata?.recordPath ?? "",
    locationType: item.locationType ?? decoded?.metadata?.locationType ?? "unknown",
    equipmentSlot: item.equipmentSlot ?? decoded?.metadata?.equipmentSlot ?? gameItem?.slot ?? null,
    itemKind: item.itemKind ?? decoded?.metadata?.itemKind ?? gameItem?.itemType?.name ?? null,
    decoderStatus: item.decoderStatus ?? decoded?.decoderStatus ?? "unknown",
    gameItem,
    score,
    decoded,
  };
}

function buildBreakdown(model, metrics, issues) {
  return {
    parseCompleteness: {
      value: metrics.parseCompleteness,
      inputs: {
        characters: model.characters.length,
        stashTabs: model.stash.tabs.length,
        itemRecords: model.stash.itemRecordCount,
        equippedItems: model.characters.find((character) => character.id === model.activeCharacterId)?.equipment?.equippedItems?.length ?? 0,
        filters: model.filters.length,
        parserCoverage: model.parser.coverage,
      },
    },
    confidence: {
      value: metrics.confidence,
      penalties: issues.map((item) => ({ issueId: item.id, priority: item.priority, severity: item.severity })),
    },
    knowledge: {
      value: metrics.knowledgeReadiness,
      profileConfidence: model.knowledge?.confidence ?? 0,
      archetype: model.knowledge?.archetype ?? null,
      tags: model.knowledge?.tags ?? {},
      gameData: model.gameData,
    },
    formulas: [
      "parseCompleteness = weighted character/stash/item/filter/parser coverage",
      "readiness scores are heuristic until game-data formulas are implemented",
      "stash candidate score = raw item byte signal + metadata completeness",
      "equipment comparison = stash raw score minus equipped raw score for matched slot",
    ],
  };
}

function chooseActiveCharacter(characters) {
  return [...characters].sort((a, b) => {
    if (a.died !== b.died) return a.died ? 1 : -1;
    return (b.level ?? 0) - (a.level ?? 0);
  })[0];
}

function scoreParseCompleteness(model, active) {
  let score = 0;
  if (active) score += 25;
  if (active?.passiveTree.hasData) score += 15;
  if (active?.skills.hasData) score += 15;
  if (model.stash.fileCount || model.stash.tabCount) score += 15;
  if (model.stash.itemRecordCount > 0) score += 15;
  if (model.filters.length > 0) score += 5;
  score += Math.min(10, Math.round((model.parser.coverage ?? 0) / 10));
  return clamp(score, 0, 100);
}

function scoreProgression(active) {
  if (!active) return 0;
  let score = Math.min(55, active.level);
  if (active.passiveTree.hasData) score += 20;
  if (active.passiveTree.unspentPoints === 0) score += 10;
  if (active.progression.completedObjectives > 0) score += 10;
  return clamp(score, 0, 100);
}

function scoreDefense(active) {
  if (!active) return 0;
  let score = active.hardcore ? 45 : 60;
  if (active.deaths > 0 || active.died) score -= 25;
  if (active.level >= 70) score -= 5;
  if (active.passiveTree.hasData) score += 10;
  return clamp(score, 0, 100);
}

function scoreSkills(active) {
  if (!active) return 0;
  const specialized = Math.min(5, active.skills.specializedTrees) * 12;
  const bar = Math.min(5, active.skills.abilityBarSlots) * 8;
  return clamp(specialized + bar, 0, 100);
}

function scoreKnowledge(knowledge) {
  if (!knowledge) return 0;
  let score = Math.round((knowledge.confidence ?? 0) * 70);
  if ((knowledge.tags?.damage ?? []).length > 0) score += 12;
  if ((knowledge.priorities ?? []).length > 0) score += 10;
  if (knowledge.archetype?.primary && knowledge.archetype.primary !== "unknown") score += 8;
  return clamp(score, 0, 100);
}

function estimateItemScore(item) {
  const explicitScore = numberValue(item.score);
  if (explicitScore !== null) return clamp(explicitScore, 0, 100);
  return clamp((item.dataLength ?? 0) + (item.quantity ?? 0) * 3 + (item.containerId === null ? 0 : 8), 0, 100);
}

function issue(id, severity, title, body, priority) {
  return { id, severity, title, body, priority };
}

function recommendation({ id, title, action, reason, expectedEffect, confidence, priority, issueIds }) {
  return {
    id,
    title,
    action,
    reason,
    expectedEffect,
    confidence: Number(confidence.toFixed(2)),
    priority,
    issueIds,
    simulation: {
      status: "estimated",
      note: "Полная симуляция появится после реализации formula engine и game data.",
    },
  };
}

function planStep(id, title, action, phase) {
  return { id, title, action, phase };
}

function stableId(...parts) {
  return parts
    .join(":")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function arrayValue(value, limit = 160) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function normalizeAbilitySlots(slots, fallbackCodes) {
  if (Array.isArray(slots)) {
    return slots
      .map((slot, index) => ({
        slot: String(slot?.slot ?? `slot${index}`),
        code: String(slot?.code ?? "").trim(),
      }))
      .filter((slot) => slot.code)
      .slice(0, 8);
  }
  return arrayValue(fallbackCodes, 8).map((code, index) => ({ slot: `slot${index}`, code: String(code) }));
}

function normalizeSkillTrees(trees) {
  return arrayValue(trees, 8).map((tree, index) => ({
    index: numberValue(tree?.index) ?? index,
    treeId: numberValue(tree?.treeId),
    abilityCode: typeof tree?.abilityCode === "string" && tree.abilityCode.trim() ? tree.abilityCode.trim() : null,
    nodes: numberValue(tree?.nodes) ?? arrayValue(tree?.nodeIdsList).length,
    nodePoints: numberValue(tree?.nodePoints) ?? arrayValue(tree?.nodePointsList).length,
    pointsAllocated: numberValue(tree?.pointsAllocated) ?? 0,
    nodeIdsList: arrayValue(tree?.nodeIdsList, 120),
    nodePointsList: arrayValue(tree?.nodePointsList, 120),
    nodesTakenList: arrayValue(tree?.nodesTakenList, 120),
  }));
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}
