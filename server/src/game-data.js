const GAME_DATA_VERSION = "le-game-data-starter-1";

const SKILL_TOKEN_RULES = [
  { token: "fire", tags: ["fire"], role: "damage", archetype: "hit-caster" },
  { token: "flame", tags: ["fire"], role: "damage", archetype: "hit-caster" },
  { token: "meteor", tags: ["fire"], role: "damage", archetype: "hit-caster" },
  { token: "volcan", tags: ["fire"], role: "damage", archetype: "dot" },
  { token: "cold", tags: ["cold"], role: "damage", archetype: "hit-caster" },
  { token: "ice", tags: ["cold"], role: "damage", archetype: "hit-caster" },
  { token: "frost", tags: ["cold"], role: "damage", archetype: "hit-caster" },
  { token: "lightning", tags: ["lightning"], role: "damage", archetype: "hit-caster" },
  { token: "storm", tags: ["lightning"], role: "damage", archetype: "hit-caster" },
  { token: "void", tags: ["void"], role: "damage", archetype: "hit" },
  { token: "necrotic", tags: ["necrotic"], role: "damage", archetype: "dot" },
  { token: "poison", tags: ["poison", "ailment"], role: "damage", archetype: "ailment" },
  { token: "bleed", tags: ["physical", "ailment"], role: "damage", archetype: "ailment" },
  { token: "ignite", tags: ["fire", "ailment"], role: "damage", archetype: "ailment" },
  { token: "physical", tags: ["physical"], role: "damage", archetype: "hit" },
  { token: "summon", tags: ["minion"], role: "minion", archetype: "minion" },
  { token: "minion", tags: ["minion"], role: "minion", archetype: "minion" },
  { token: "skeleton", tags: ["minion", "necrotic"], role: "minion", archetype: "minion" },
  { token: "wraith", tags: ["minion", "necrotic"], role: "minion", archetype: "minion" },
  { token: "golem", tags: ["minion"], role: "minion", archetype: "minion" },
  { token: "wolf", tags: ["minion", "physical"], role: "minion", archetype: "minion" },
  { token: "totem", tags: ["minion"], role: "minion", archetype: "minion" },
  { token: "ballista", tags: ["minion", "physical"], role: "minion", archetype: "minion" },
  { token: "ward", tags: ["ward"], role: "defense" },
  { token: "armor", tags: ["armor"], role: "defense" },
  { token: "heal", tags: ["sustain"], role: "defense" },
  { token: "transplant", tags: ["movement"], role: "utility" },
  { token: "teleport", tags: ["movement"], role: "utility" },
  { token: "lunge", tags: ["movement"], role: "utility" },
  { token: "shift", tags: ["movement"], role: "utility" },
  { token: "dash", tags: ["movement"], role: "utility" },
];

const STASH_TOKEN_RULES = [
  { token: "idol", tags: ["idols"], label: "вкладка идолов" },
  { token: "unique", tags: ["uniques"], label: "вкладка уникальных предметов" },
  { token: "exalt", tags: ["exalted"], label: "вкладка exalted предметов" },
  { token: "legend", tags: ["legendary"], label: "вкладка legendary bases" },
  { token: "shard", tags: ["crafting"], label: "вкладка крафтовых материалов" },
  { token: "craft", tags: ["crafting"], label: "вкладка крафта" },
  { token: "blessing", tags: ["blessings"], label: "вкладка blessings" },
];

export function summarizeGameData() {
  return {
    version: GAME_DATA_VERSION,
    status: "starter",
    coverage: {
      skillTokenRules: SKILL_TOKEN_RULES.length,
      stashTokenRules: STASH_TOKEN_RULES.length,
      exactItemBases: 0,
      exactAffixes: 0,
      exactPassiveNodes: 0,
    },
    limitations: [
      "Это стартовая локальная база правил, а не полный datamine Last Epoch.",
      "Она помогает определить архетип и приоритеты, но пока не называет exact item base, affix tier или passive node.",
    ],
  };
}

export function buildKnowledgeProfile(character, context = {}) {
  if (!character) return null;

  const phase = character.level >= 70 ? "endgame" : "leveling";
  const skillSignals = collectSkillSignals(character.skills?.abilityCodes ?? []);
  const stashSignals = collectStashSignals(context.stash);
  const damageTags = unique(skillSignals.flatMap((signal) => signal.tags).filter((tag) => DAMAGE_TAGS.has(tag)));
  const utilityTags = unique(skillSignals.flatMap((signal) => signal.tags).filter((tag) => UTILITY_TAGS.has(tag)));
  const defensiveTags = unique(skillSignals.flatMap((signal) => signal.tags).filter((tag) => DEFENSIVE_TAGS.has(tag)));
  const archetype = chooseArchetype(skillSignals, damageTags);
  const priorities = buildPriorities({ character, phase, archetype, damageTags, utilityTags, defensiveTags, stashSignals });
  const confidence = calculateKnowledgeConfidence({ character, skillSignals, damageTags, archetype });

  return {
    version: GAME_DATA_VERSION,
    phase,
    class: {
      classId: character.classId ?? null,
      masteryId: character.masteryId ?? null,
      label: character.classId === null || character.classId === undefined ? "класс не распознан" : `classId ${character.classId}`,
    },
    archetype,
    tags: {
      damage: damageTags,
      utility: utilityTags,
      defensive: defensiveTags,
      stash: unique(stashSignals.flatMap((signal) => signal.tags)),
    },
    skillSignals,
    stashSignals,
    priorities,
    confidence,
  };
}

function collectSkillSignals(abilityCodes) {
  const signals = [];
  for (const rawCode of abilityCodes ?? []) {
    const code = String(rawCode ?? "").toLowerCase();
    if (!code) continue;
    for (const rule of SKILL_TOKEN_RULES) {
      if (!code.includes(rule.token)) continue;
      signals.push({
        source: rawCode,
        token: rule.token,
        role: rule.role,
        tags: rule.tags,
        archetype: rule.archetype ?? null,
      });
    }
  }
  return dedupeSignals(signals);
}

function collectStashSignals(stash) {
  const names = [
    ...(stash?.namedTabs ?? []),
    ...(stash?.tabs ?? []).map((tab) => tab.name ?? tab.displayName ?? tab.stashId ?? ""),
  ];
  const signals = [];
  for (const rawName of names) {
    const name = String(rawName ?? "").toLowerCase();
    if (!name) continue;
    for (const rule of STASH_TOKEN_RULES) {
      if (!name.includes(rule.token)) continue;
      signals.push({
        source: rawName,
        token: rule.token,
        tags: rule.tags,
        label: rule.label,
      });
    }
  }
  return dedupeSignals(signals);
}

function chooseArchetype(skillSignals, damageTags) {
  const archetypeCounts = new Map();
  for (const signal of skillSignals) {
    if (!signal.archetype) continue;
    archetypeCounts.set(signal.archetype, (archetypeCounts.get(signal.archetype) ?? 0) + 1);
  }

  const primary = [...archetypeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
  const names = {
    ailment: "ailment / damage over time",
    dot: "damage over time",
    hit: "hit damage",
    "hit-caster": "hit-caster",
    minion: "minion",
    unknown: "архетип не распознан",
  };
  const hasMultipleDamageTags = damageTags.length > 1;

  return {
    primary,
    name: names[primary] ?? primary,
    secondary: hasMultipleDamageTags ? "hybrid damage tags" : null,
    signals: Object.fromEntries(archetypeCounts),
  };
}

function buildPriorities({ character, phase, archetype, damageTags, utilityTags, defensiveTags, stashSignals }) {
  const priorities = [];
  const hardcoreRisk = Boolean(character.hardcore || character.deaths > 0 || character.died);

  priorities.push({
    id: "defensive-floor",
    title: hardcoreRisk ? "Сначала поднять запас выживаемости" : "Проверить защитный минимум",
    action: "Проверь здоровье, capped resistances, endurance, armor/ward и стабильный sustain перед заменой предметов на урон.",
    reason: hardcoreRisk
      ? "В snapshot есть Hardcore/смерти, поэтому любые offensive upgrades нужно оценивать после защитного минимума."
      : "Без точного formula engine безопаснее сначала закрывать базовую защиту, потом усиливать урон.",
    expectedEffect: "меньше случайных смертей и стабильнее прохождение монолитов/кампании",
    tags: ["health", "resistances", "endurance", ...defensiveTags],
    confidence: hardcoreRisk ? 0.82 : 0.68,
    priority: hardcoreRisk ? 96 : 78,
  });

  if (damageTags.length > 0) {
    priorities.push({
      id: "scale-primary-damage",
      title: "Усилить основной тип урона",
      action: `В предметах, идолах и пассивках приоритизируй теги: ${damageTags.join(", ")}. Смешанные бонусы без этих тегов проверяй позже.`,
      reason: "Система нашла damage-теги в активных навыках, поэтому может сузить поиск полезных affix/idol кандидатов.",
      expectedEffect: "больше урона без распыления affix budget",
      tags: damageTags,
      confidence: 0.64,
      priority: 84,
    });
  }

  if (archetype.primary === "minion") {
    priorities.push({
      id: "minion-scaling",
      title: "Проверить усиление миньонов",
      action: "В сундуке и идолах ищи урон миньонов, здоровье/выживаемость миньонов и бонусы к ключевым навыкам призыва.",
      reason: "На панели навыков найдены сигналы билда через миньонов/призыв.",
      expectedEffect: "питомцы живут дольше и лучше конвертируют affix budget в урон",
      tags: ["minion"],
      confidence: 0.7,
      priority: 82,
    });
  }

  if (!utilityTags.includes("movement")) {
    priorities.push({
      id: "movement-check",
      title: "Проверить mobility-слот",
      action: "Убедись, что на панели есть движение или быстрый reposition-навык, особенно перед монолитами и боссами.",
      reason: "В распознанных skill code не найден явный movement-сигнал.",
      expectedEffect: "меньше урона от механик и быстрее зачистка",
      tags: ["movement"],
      confidence: 0.48,
      priority: phase === "endgame" ? 66 : 54,
    });
  }

  if (stashSignals.some((signal) => signal.tags.includes("idols"))) {
    priorities.push({
      id: "review-idols",
      title: "Разобрать вкладку идолов",
      action: "Отдельно проверь идолы под основной damage tag и защиту; часто это быстрый апгрейд без замены редких предметов.",
      reason: "В названиях stash-вкладок найдена вкладка идолов.",
      expectedEffect: "быстрый прирост урона или выживаемости из уже доступного stash",
      tags: ["idols"],
      confidence: 0.6,
      priority: 72,
    });
  }

  if (phase === "endgame") {
    priorities.push({
      id: "endgame-checklist",
      title: "Подготовить эндгейм-чеклист",
      action: "Перед точным сравнением предметов зафиксируй цель билда: основной навык, теги урона, защитный слой, благословения и нужные идолы.",
      reason: "Персонаж уже в эндгейм-диапазоне, поэтому случайные замены предметов могут ломать баланс защиты и урона.",
      expectedEffect: "рекомендации станут последовательнее после следующего snapshot",
      tags: ["planning", "blessings", "idols"],
      confidence: 0.58,
      priority: 64,
    });
  }

  return priorities.sort((a, b) => b.priority - a.priority).slice(0, 6);
}

function calculateKnowledgeConfidence({ character, skillSignals, damageTags, archetype }) {
  let score = 0.16;
  if ((character.skills?.abilityCodes ?? []).length > 0) score += 0.18;
  if (skillSignals.length > 0) score += 0.22;
  if (damageTags.length > 0) score += 0.18;
  if (archetype.primary !== "unknown") score += 0.16;
  if (character.passiveTree?.hasData) score += 0.05;
  if (character.level > 0) score += 0.05;
  return Number(Math.min(0.9, score).toFixed(2));
}

function dedupeSignals(signals) {
  const seen = new Set();
  const result = [];
  for (const signal of signals) {
    const key = `${signal.source}:${signal.token}:${signal.role ?? signal.label ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(signal);
  }
  return result;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

const DAMAGE_TAGS = new Set(["fire", "cold", "lightning", "void", "necrotic", "poison", "physical", "ailment"]);
const UTILITY_TAGS = new Set(["movement"]);
const DEFENSIVE_TAGS = new Set(["ward", "armor", "sustain"]);
