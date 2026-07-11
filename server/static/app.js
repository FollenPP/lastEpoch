const state = {
  snapshots: [],
  selectedId: null,
  tokenVisible: false,
};

const serverInfo = document.querySelector("#serverInfo");
const snapshotList = document.querySelector("#snapshotList");
const pairingList = document.querySelector("#pairingList");
const snapshotDetail = document.querySelector("#snapshotDetail");
const emptyState = document.querySelector("#emptyState");
const refreshButton = document.querySelector("#refreshButton");
const pairingToken = document.querySelector("#pairingToken");
const toggleToken = document.querySelector("#toggleToken");
const saveToken = document.querySelector("#saveToken");

refreshButton.addEventListener("click", () => load());
saveToken.addEventListener("click", () => {
  localStorage.setItem("leCompanionAccessToken", pairingToken.value.trim());
  load();
});
toggleToken.addEventListener("click", () => {
  state.tokenVisible = !state.tokenVisible;
  pairingToken.type = state.tokenVisible ? "text" : "password";
  toggleToken.textContent = state.tokenVisible ? "Скрыть" : "Показать";
});

await load();

async function load() {
  pairingToken.value = localStorage.getItem("leCompanionAccessToken") ?? "";
  await Promise.all([loadServerInfo(), loadPairingToken(), loadPairings(), loadSnapshots()]);
  renderSnapshots();
  if (state.selectedId) {
    await selectSnapshot(state.selectedId);
  }
}

async function loadServerInfo() {
  const health = await api("/api/health");
  serverInfo.innerHTML = "";
  addDetail("Адрес", `${location.origin}`);
  addDetail("LAN", health.lanUrls?.join("\n") || "нет локального IPv4");
  addDetail("Данные", health.dataDir);
}

async function loadPairingToken() {
  try {
    const response = await api("/api/pairing");
    pairingToken.value = response.pairingToken;
    localStorage.setItem("leCompanionAccessToken", response.pairingToken);
  } catch {
    if (!pairingToken.value) pairingToken.placeholder = "Вставь access token сервера";
  }
}

async function loadSnapshots() {
  try {
    const response = await api("/api/snapshots", { auth: true });
    state.snapshots = response.snapshots ?? [];
    if (!state.selectedId && state.snapshots.length > 0) {
      state.selectedId = state.snapshots[0].id;
    }
  } catch {
    state.snapshots = [];
    state.selectedId = null;
  }
}

async function loadPairings() {
  try {
    const response = await api("/api/device-pairings", { auth: true });
    renderPairings(response.pairings ?? []);
  } catch {
    pairingList.innerHTML = `<p class="snapshotMeta">Сохрани access token, чтобы видеть запросы пары.</p>`;
  }
}

function renderSnapshots() {
  snapshotList.innerHTML = "";
  if (state.snapshots.length === 0) {
    snapshotList.innerHTML = `<p class="muted">Снимков пока нет.</p>`;
    return;
  }

  const template = document.querySelector("#snapshotButtonTemplate");
  for (const snapshot of state.snapshots) {
    const node = template.content.cloneNode(true);
    const button = node.querySelector(".snapshotButton");
    button.classList.toggle("active", snapshot.id === state.selectedId);
    node.querySelector(".snapshotTitle").textContent = snapshot.deckName || "Steam Deck";
    node.querySelector(".snapshotMeta").textContent = `${formatDate(snapshot.createdAt)} - ${snapshot.fileCount} файл(ов)`;
    button.addEventListener("click", () => selectSnapshot(snapshot.id));
    snapshotList.appendChild(node);
  }
}

async function selectSnapshot(id) {
  state.selectedId = id;
  renderSnapshots();
  const response = await api(`/api/v1/snapshots/${encodeURIComponent(id)}`, { auth: true });
  renderSnapshotDetail(response.snapshot, response.analysis, response.buildAnalysis);
}

function renderPairings(pairings) {
  pairingList.innerHTML = "";
  if (pairings.length === 0) {
    pairingList.innerHTML = `<p class="snapshotMeta">Нет ожидающих устройств.</p>`;
    return;
  }

  for (const pairing of pairings) {
    const button = document.createElement("button");
    button.className = "snapshotButton";
    button.innerHTML = `
      <span class="snapshotTitle">${escapeHtml(pairing.deckName)} - ${escapeHtml(pairing.code)}</span>
      <span class="snapshotMeta">${escapeHtml(pairing.status)} - ${formatDate(pairing.createdAt)}</span>
    `;
    button.disabled = pairing.status === "approved";
    button.addEventListener("click", () => approvePairing(pairing.id));
    pairingList.appendChild(button);
  }
}

async function approvePairing(id) {
  await api(`/api/device-pairings/${encodeURIComponent(id)}/approve`, { method: "POST", auth: true });
  await loadPairings();
}

function renderSnapshotDetail(snapshot, analysis, buildAnalysis) {
  emptyState.classList.add("hidden");
  snapshotDetail.classList.remove("hidden");

  const summary = analysis?.summary ?? {};
  const game = analysis?.game ?? emptyGame();
  snapshotDetail.innerHTML = `
    <div class="sectionHeader">
      <div>
        <p class="eyebrow">${escapeHtml(snapshot.deckName ?? "Steam Deck")}</p>
        <h2>Снимок ${escapeHtml(snapshot.id)}</h2>
        <p class="muted">Получен ${formatDate(snapshot.receivedAt)}. Плагин: ${escapeHtml(snapshot.pluginVersion ?? "unknown")}. Источник: ${escapeHtml(sourceLabel(snapshot.source))}.</p>
      </div>
      <div class="actionRow">
        <button id="reanalyzeButton">Переанализировать</button>
        <button id="filterButton" class="primary">Создать review-фильтр</button>
      </div>
    </div>

    <section class="summaryGrid">
      ${metric("Файлы", summary.totalFiles ?? snapshot.fileCount ?? 0)}
      ${metric("Персонажи", summary.characterFiles ?? 0)}
      ${metric("Файлы сундука", summary.stashFiles ?? 0)}
      ${metric("Фильтры", summary.filterFiles ?? 0)}
      ${metric("EPOCH/JSON", summary.jsonFiles ?? 0)}
      ${metric("Читаемость", `${summary.parserCoverage ?? 0}%`)}
    </section>

    <section class="section">
      <h2>Игровой обзор</h2>
      ${renderGameOverview(game)}
    </section>

    <section class="section">
      <h2>Анализ билда</h2>
      ${renderBuildAnalysis(buildAnalysis)}
    </section>

    <section class="section">
      <h2>Советы</h2>
      <div class="recommendations">
        ${(analysis?.recommendations ?? []).map(renderRecommendation).join("")}
      </div>
    </section>

    <section class="section">
      <h2>Персонажи и прокачка</h2>
      ${renderCharacters(game.characters)}
    </section>

    <section class="section">
      <h2>Сундук</h2>
      ${renderStash(game.stash)}
    </section>

    <section class="section">
      <h2>Карточки предметных записей</h2>
      ${renderItemCards(game.items)}
    </section>

    <section class="section">
      <h2>Фильтры добычи</h2>
      ${renderFilters(game.filters)}
    </section>

    <section class="section">
      <h2>Технические файлы</h2>
      ${renderFilesTable(analysis?.files ?? [])}
    </section>

    <section class="section">
      <h2>Raw Snapshot</h2>
      <pre>${escapeHtml(JSON.stringify(snapshot, null, 2))}</pre>
    </section>
  `;

  document.querySelector("#reanalyzeButton").addEventListener("click", () => reanalyze(snapshot.id));
  document.querySelector("#filterButton").addEventListener("click", () => generateFilter(snapshot.id));
}

function emptyGame() {
  return {
    characters: [],
    stash: { files: [], tabs: [], totalGold: 0, totalItemRecords: 0, namedTabs: [] },
    filters: [],
    items: { cards: [], totalRecords: 0 },
    build: { hasPassiveTreeData: false, hasSkillTreeData: false, parserStage: "unknown" },
  };
}

function renderGameOverview(game) {
  return `
    <div class="cardGrid">
      ${infoCard("Персонажи", `${game.characters.length}`, "Найденные файлы 1CHARACTERSLOT.")}
      ${infoCard("Золото в сундуках", formatNumber(game.stash.totalGold ?? 0), "Сумма по распознанным STASH_CYCLE файлам.")}
      ${infoCard("Записи предметов", `${game.items.totalRecords ?? 0}`, "Сырые itemData-записи для будущего сравнения предметов.")}
      ${infoCard("Дерево/скиллы", game.build.hasPassiveTreeData || game.build.hasSkillTreeData ? "найдены" : "не найдены", "Пока показываем состояние, без карты nodeID -> название узла.")}
    </div>
  `;
}

function renderBuildAnalysis(buildAnalysis) {
  if (!buildAnalysis) return `<p class="muted">Build-анализ пока не создан.</p>`;
  const character = activeCharacter(buildAnalysis.model);
  return `
    ${renderBuildHero(character, buildAnalysis)}
    <div class="buildDashboard">
      <div class="buildMain">
        ${renderEquipmentBoard(character)}
        ${renderBuildTrees(character)}
        <section class="buildPanel">
          <div class="panelHeading">
            <div>
              <p class="eyebrow">Stash upgrades</p>
              <h3>Кандидаты на замену</h3>
            </div>
            <span class="pill info">${displayValue(buildAnalysis.model?.stash?.upgradeCandidates?.length ?? 0)} найдено</span>
          </div>
          ${renderUpgradeCandidates(buildAnalysis.model?.stash?.upgradeCandidates ?? [])}
        </section>
      </div>
      <aside class="buildAside">
        <section class="sidePanel">
          <h3>Готовность данных</h3>
          <div class="scoreList">
            ${scoreRow("Полнота", buildAnalysis.metrics?.parseCompleteness)}
            ${scoreRow("Уверенность", buildAnalysis.metrics?.confidence)}
            ${scoreRow("Прокачка", buildAnalysis.metrics?.progressionReadiness)}
            ${scoreRow("Защита", buildAnalysis.metrics?.defensiveReadiness)}
            ${scoreRow("Скиллы", buildAnalysis.metrics?.skillReadiness)}
            ${scoreRow("Stash", buildAnalysis.metrics?.stashReadiness)}
            ${scoreRow("Game data", buildAnalysis.metrics?.knowledgeReadiness)}
          </div>
        </section>
        ${renderBuildProfile(buildAnalysis.model?.knowledge, buildAnalysis.model?.gameData)}
        <section class="sidePanel">
          <h3>Проблемы</h3>
          ${renderIssues(buildAnalysis.issues ?? [])}
        </section>
        <section class="sidePanel">
          <h3>Рекомендации</h3>
          ${renderBuildRecommendations(buildAnalysis.recommendations ?? [])}
        </section>
      </aside>
    </div>
    <section class="buildPanel">
      <div class="panelHeading">
        <div>
          <p class="eyebrow">Next steps</p>
          <h3>План развития</h3>
        </div>
      </div>
      ${renderPlan(buildAnalysis.plan?.steps ?? [])}
    </section>
  `;
}

function activeCharacter(model) {
  if (!model) return null;
  return model.characters?.find((character) => character.id === model.activeCharacterId) ?? model.characters?.[0] ?? null;
}

function renderBuildHero(character, buildAnalysis) {
  const profile = buildAnalysis.model?.knowledge;
  const archetype = profile?.archetype?.name ?? "архетип уточняется";
  const mode = character?.hardcore ? "Hardcore" : "Softcore";
  return `
    <section class="buildHero">
      <div>
        <p class="eyebrow">Active build</p>
        <h2>${escapeHtml(character?.name ?? "Персонаж не выбран")}</h2>
        <p>${escapeHtml(archetype)} · ${escapeHtml(mode)} · уровень ${displayValue(character?.level)}</p>
      </div>
      <div class="heroStats">
        ${metric("Confidence", `${buildAnalysis.metrics?.confidence ?? 0}%`)}
        ${metric("Items", character?.equipment?.rawItemRecords ?? 0)}
        ${metric("Passives", character?.passiveTree?.nodes ?? 0)}
        ${metric("Skills", character?.skills?.specializedTrees ?? 0)}
      </div>
    </section>
  `;
}

function renderEquipmentBoard(character) {
  const equipment = character?.equipment;
  const equippedItems = equipment?.equippedItems ?? [];
  const inventoryItems = equipment?.inventoryItems ?? [];
  const slots = [
    ["helmet", "Шлем"],
    ["amulet", "Амулет"],
    ["body", "Броня"],
    ["weapon", "Оружие"],
    ["offhand", "Левая рука"],
    ["gloves", "Перчатки"],
    ["ring", "Кольцо"],
    ["belt", "Пояс"],
    ["boots", "Ботинки"],
    ["relic", "Реликвия"],
    ["idol", "Идолы"],
  ];
  const slotMap = equipment?.slots ?? {};
  return `
    <section class="buildPanel">
      <div class="panelHeading">
        <div>
          <p class="eyebrow">Equipment</p>
          <h3>Экипировка персонажа</h3>
        </div>
        <span class="pill ${equippedItems.length ? "success" : "warning"}">${equipmentStatusLabel(equipment?.status)}</span>
      </div>
      <div class="equipmentStats">
        ${metric("Надето", equippedItems.length)}
        ${metric("Записей", equipment?.rawItemRecords ?? 0)}
        ${metric("Инвентарь", inventoryItems.length)}
      </div>
      <div class="equipmentBoard">
        ${slots.map(([slot, label]) => renderEquipmentSlot(slot, label, slotMap[slot])).join("")}
      </div>
      ${
        equippedItems.length
          ? ""
          : `<p class="muted">Сейв загружен, но надетые слоты пока определены не полностью. Когда itemData даст слот, карточка автоматически встанет в сетку.</p>`
      }
    </section>
  `;
}

function renderEquipmentSlot(slot, label, item) {
  if (!item) {
    return `
      <div class="equipmentSlot empty">
        <span class="slotLabel">${escapeHtml(label)}</span>
        <span class="emptySlot">пусто</span>
      </div>
    `;
  }
  return `
    <div class="equipmentSlot filled rarity-${itemRarity(item)}">
      <span class="slotLabel">${escapeHtml(label)}</span>
      ${renderCompactItemContent(item)}
    </div>
  `;
}

function renderCompactItemContent(item) {
  return `
    <div class="compactItemName">${escapeHtml(itemDisplayName(item))}</div>
    <div class="compactItemMeta">
      <span>${rarityLabel(itemRarity(item))}</span>
      <span>score ${displayValue(item.score)}</span>
    </div>
    <div class="compactItemFooter">${escapeHtml(item.fingerprint ?? "без fingerprint")}</div>
  `;
}

function renderBuildTrees(character) {
  return `
    <section class="buildPanel">
      <div class="panelHeading">
        <div>
          <p class="eyebrow">Skills & passives</p>
          <h3>Дерево прокачки</h3>
        </div>
        <span class="pill info">${displayValue(character?.passiveTree?.unspentPoints ?? 0)} свободно</span>
      </div>
      ${renderAbilityBar(character?.skills)}
      <div class="treeLayout">
        ${renderPassiveTree(character?.passiveTree)}
        ${renderSkillTrees(character?.skills)}
      </div>
    </section>
  `;
}

function renderAbilityBar(skills) {
  const slots = skills?.abilitySlots?.length
    ? skills.abilitySlots
    : (skills?.abilityCodes ?? []).map((code, index) => ({ slot: `slot${index}`, code }));
  const normalized = Array.from({ length: 5 }, (_, index) => slots[index] ?? { slot: `slot${index}`, code: null });
  return `
    <div class="skillBar">
      ${normalized
        .map(
          (slot, index) => `
            <div class="skillGem ${slot.code ? "filled" : "empty"}">
              <span>${index + 1}</span>
              <strong>${escapeHtml(slot.code ?? "пусто")}</strong>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderPassiveTree(tree) {
  const nodes = tree?.nodeIdsList?.length ? tree.nodeIdsList : tree?.nodesTakenList ?? [];
  const nodeTotal = tree?.nodes ?? nodes.length ?? 0;
  return `
    <div class="treeCard passiveTree">
      <div class="treeHeader">
        <div>
          <p class="eyebrow">Passive tree ${displayValue(tree?.treeId)}</p>
          <h4>Пассивки</h4>
        </div>
        <span>${displayValue(nodeTotal)} узлов</span>
      </div>
      ${renderTreeNodes(nodes, tree?.nodePointsList ?? [], nodeTotal)}
    </div>
  `;
}

function renderSkillTrees(skills) {
  const trees = skills?.trees ?? [];
  if (!trees.length) {
    return `
      <div class="treeCard">
        <div class="treeHeader">
          <div>
            <p class="eyebrow">Specializations</p>
            <h4>Скилл-деревья</h4>
          </div>
        </div>
        <p class="muted">Специализации пока видны только счетчиком: ${displayValue(skills?.specializedTrees ?? 0)}.</p>
      </div>
    `;
  }
  return `
    <div class="skillTreeStack">
      ${trees
        .map(
          (tree, index) => `
            <div class="treeCard skillTreeCard">
              <div class="treeHeader">
                <div>
                  <p class="eyebrow">Skill tree ${displayValue(tree.treeId ?? index + 1)}</p>
                  <h4>${escapeHtml(tree.abilityCode ?? `Специализация ${index + 1}`)}</h4>
                </div>
                <span>${displayValue(tree.pointsAllocated || tree.nodePoints || tree.nodes)} очков</span>
              </div>
              ${renderTreeNodes(tree.nodeIdsList?.length ? tree.nodeIdsList : tree.nodesTakenList ?? [], tree.nodePointsList ?? [], tree.nodes ?? 0)}
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderTreeNodes(nodeIds, nodePoints, totalCount) {
  const nodes = nodeIds?.length
    ? nodeIds.slice(0, 72)
    : Array.from({ length: Math.min(Number(totalCount ?? 0), 48) }, (_, index) => index + 1);
  if (!nodes.length) {
    return `<p class="muted">Узлы дерева в этом snapshot не найдены.</p>`;
  }
  return `
    <div class="treeBoard">
      ${nodes
        .map((node, index) => {
          const points = Number(nodePoints?.[index] ?? 1);
          const strength = points >= 5 ? "high" : points >= 2 ? "mid" : "low";
          return `
            <div class="treeNode ${strength}" title="Node ${escapeHtml(node)} · ${displayValue(points)} points">
              <span>${escapeHtml(shortNodeLabel(node))}</span>
              <small>${Number.isFinite(points) ? points : 1}</small>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function shortNodeLabel(value) {
  const text = String(value ?? "");
  return text.length > 4 ? text.slice(-4) : text;
}

function renderGameItemCard(item, options = {}) {
  const rarity = itemRarity(item);
  const compact = Boolean(options.compact);
  return `
    <article class="gameItemCard rarity-${rarity} ${compact ? "compact" : ""}">
      <div class="gameItemTop">
        <div>
          <p class="itemRarity">${rarityLabel(rarity)}</p>
          <h3>${escapeHtml(itemDisplayName(item))}</h3>
        </div>
        <span class="itemScore">${displayValue(item.score)}</span>
      </div>
      <div class="itemMetaLine">
        <span>${locationTypeLabel(item.locationType)}</span>
        <span>${escapeHtml(slotLabel(item.equipmentSlot ?? item.itemKind))}</span>
        <span>${sourceTypeLabel(item.sourceType)}</span>
      </div>
      ${renderItemAffixes(item)}
      <div class="itemFooter">
        <span>${escapeHtml(item.fingerprint ?? "no fingerprint")}</span>
        <span>${decoderStatusLabel(item.decoderStatus)}</span>
      </div>
      ${options.compare ? renderItemComparison(item) : ""}
    </article>
  `;
}

function renderItemAffixes(item) {
  const fields = item.decoded?.metadata?.directFields ?? {};
  const directRows = Object.entries(fields).slice(0, 5);
  if (directRows.length) {
    return `
      <div class="affixList">
        ${directRows
          .map(([key, value]) => `<div class="affixRow"><span>${escapeHtml(key)}</span><strong>${escapeHtml(value)}</strong></div>`)
          .join("")}
      </div>
    `;
  }
  return `
    <div class="affixList locked">
      <div class="affixRow"><span>Base / affixes</span><strong>нужен itemData mapping</strong></div>
      <div class="affixRow"><span>Raw data</span><strong>${displayValue(item.dataLength)} bytes</strong></div>
      <div class="affixRow"><span>Hex</span><strong>${escapeHtml(item.decoded?.previewHex ?? "нет")}</strong></div>
    </div>
  `;
}

function renderItemComparison(item) {
  const comparison = item.comparison ?? {};
  return `
    <div class="comparisonStrip">
      <span>${comparisonStatusLabel(comparison.status)}</span>
      <strong>${comparison.scoreDelta === null || comparison.scoreDelta === undefined ? "delta ?" : `${comparison.scoreDelta > 0 ? "+" : ""}${comparison.scoreDelta}`}</strong>
    </div>
  `;
}

function itemDisplayName(item) {
  const fields = item.decoded?.metadata?.directFields ?? {};
  const base =
    fields.uniqueID ??
    fields.uniqueId ??
    fields.baseType ??
    fields.itemType ??
    fields.itemTypeID ??
    fields.itemTypeId ??
    item.equipmentSlot ??
    item.itemKind;
  const label = slotLabel(base);
  const fingerprint = item.fingerprint ? ` #${String(item.fingerprint).slice(0, 6)}` : "";
  return `${label}${fingerprint}`;
}

function itemRarity(item) {
  const fields = item.decoded?.metadata?.directFields ?? {};
  const signal = `${fields.rarity ?? ""} ${fields.uniqueID ?? ""} ${fields.uniqueId ?? ""} ${item.sourceName ?? ""} ${item.recordPath ?? ""}`.toLowerCase();
  if (signal.includes("legendary")) return "legendary";
  if (signal.includes("unique")) return "unique";
  if (signal.includes("set")) return "set";
  if (signal.includes("exalted")) return "exalted";
  const score = Number(item.score ?? 0);
  if (score >= 90) return "exalted";
  if (score >= 70) return "rare";
  if (score >= 45) return "magic";
  return "normal";
}

function rarityLabel(rarity) {
  return (
    {
      legendary: "Legendary",
      unique: "Unique",
      set: "Set",
      exalted: "Exalted",
      rare: "Rare",
      magic: "Magic",
      normal: "Item",
    }[rarity] ?? "Item"
  );
}

function slotLabel(value) {
  return (
    {
      helmet: "Шлем",
      body: "Броня",
      gloves: "Перчатки",
      boots: "Ботинки",
      belt: "Пояс",
      relic: "Реликвия",
      amulet: "Амулет",
      ring: "Кольцо",
      weapon: "Оружие",
      offhand: "Левая рука",
      idol: "Идол",
    }[value] ?? displayValue(value)
  );
}

function scoreRow(label, value) {
  const number = Number(value ?? 0);
  return `
    <div class="scoreRow">
      <span>${escapeHtml(label)}</span>
      <div class="scoreTrack"><i style="width:${Math.max(0, Math.min(100, number))}%"></i></div>
      <strong>${Number.isFinite(number) ? Math.round(number) : 0}%</strong>
    </div>
  `;
}

function renderBuildProfile(profile, gameData) {
  if (!profile) {
    return `<section class="sidePanel"><p class="muted">Профиль билда появится после распознавания персонажа.</p></section>`;
  }
  return `
    <section class="sidePanel buildProfile">
      <h3>Профиль билда</h3>
      <div class="cardGrid smallCards">
        ${infoCard("Архетип", profile.archetype?.name ?? "не распознан", `Уверенность game-data слоя: ${Math.round((profile.confidence ?? 0) * 100)}%.`)}
        ${infoCard("Фаза", profile.phase === "endgame" ? "endgame" : "прокачка", `База знаний: ${gameData?.version ?? profile.version ?? "starter"}.`)}
        ${infoCard("Damage tags", profile.tags?.damage?.join(", ") || "не найдены", "Теги из активных навыков, по которым стоит фильтровать урон и идолы.")}
        ${infoCard("Utility", profile.tags?.utility?.join(", ") || "не найдена", "Movement/sustain/utility сигналы из skill bar.")}
      </div>
      ${renderPriorityList(profile.priorities ?? [])}
    </section>
  `;
}

function renderPriorityList(priorities) {
  if (!priorities.length) return `<p class="muted">Приоритеты появятся после распознавания skill/tag сигналов.</p>`;
  return `
    <div class="recommendations">
      ${priorities
        .slice(0, 4)
        .map(
          (item) => `
            <article class="recommendation">
              <h3>${escapeHtml(item.title)}</h3>
              <p>${escapeHtml(item.action)}</p>
              <p class="muted">${escapeHtml(item.expectedEffect)} · ${escapeHtml((item.tags ?? []).join(", ") || "без тегов")}</p>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderIssues(issues) {
  if (!issues.length) return `<p class="muted">Критичных проблем по доступным данным не найдено.</p>`;
  return `
    <div class="recommendations">
      ${issues
        .map(
          (issue) => `
            <article class="recommendation ${escapeHtml(issue.severity)}">
              <h3>${escapeHtml(issue.title)}</h3>
              <p>${escapeHtml(issue.body)}</p>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderBuildRecommendations(recommendations) {
  if (!recommendations.length) return `<p class="muted">Рекомендаций пока нет.</p>`;
  return `
    <div class="recommendations">
      ${recommendations
        .map(
          (item) => `
            <article class="recommendation">
              <h3>${escapeHtml(item.title)}</h3>
              <p>${escapeHtml(item.action)}</p>
              <p class="muted">${escapeHtml(item.expectedEffect)} · уверенность ${Math.round((item.confidence ?? 0) * 100)}%</p>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderPlan(steps) {
  if (!steps.length) return `<p class="muted">План появится после анализа персонажа.</p>`;
  return `
    <div class="cardGrid smallCards">
      ${steps
        .map(
          (step) => `
            <article class="infoCard">
              <p class="eyebrow">${escapeHtml(step.phase)}</p>
              <h3>${escapeHtml(step.title)}</h3>
              <p>${escapeHtml(step.action)}</p>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderUpgradeCandidates(candidates) {
  if (!candidates.length) {
    return `<p class="muted">Кандидаты появятся после расшифровки itemData или когда stash содержит предметные записи.</p>`;
  }
  return `
    <div class="gameItemGrid">
      ${candidates.slice(0, 12).map((item) => renderGameItemCard(item, { compare: true })).join("")}
    </div>
  `;
}

function renderCharacters(characters) {
  if (!characters?.length) return `<p class="muted">Персонажи не найдены.</p>`;
  return `
    <div class="cardGrid">
      ${characters
        .map(
          (character) => `
            <article class="infoCard characterCard">
              <div class="cardTop">
                <div>
                  <p class="eyebrow">${escapeHtml(character.file)}</p>
                  <h3>${escapeHtml(character.name ?? "Без имени")}</h3>
                </div>
                <span class="pill ${character.hardcore ? "warning" : "info"}">${character.hardcore ? "Hardcore" : "Softcore"}</span>
              </div>
              <div class="kvGrid">
                ${kv("Уровень", displayValue(character.level))}
                ${kv("Класс ID", displayValue(character.classId))}
                ${kv("Смерти", displayValue(character.deaths ?? (character.died ? 1 : 0)))}
                ${kv("Время", character.totalPlaytimeHours === null || character.totalPlaytimeHours === undefined ? "не найдено" : `${character.totalPlaytimeHours} ч`)}
              </div>
              <div class="subPanel">
                <h4>Дерево прокачки</h4>
                <div class="kvGrid compact">
                  ${kv("Tree ID", displayValue(character.passiveTree?.treeId))}
                  ${kv("Узлы", displayValue(character.passiveTree?.nodeIds || character.passiveTree?.nodesTaken))}
                  ${kv("Очки узлов", displayValue(character.passiveTree?.nodePoints))}
                  ${kv("Свободно", displayValue(character.passiveTree?.unspentPoints))}
                </div>
              </div>
              <div class="subPanel">
                <h4>Скиллы</h4>
                <p class="muted">Специализаций: ${displayValue(character.skills?.specializedTrees)}. Слотов панели: ${displayValue(character.skills?.abilityBarSlots)}.</p>
                ${renderTags(character.skills?.abilityCodes ?? [])}
              </div>
              ${renderCharacterAdvice(character.advice ?? [])}
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderCharacterAdvice(items) {
  if (!items.length) return "";
  return `
    <div class="subPanel">
      <h4>Что проверить дальше</h4>
      <ul class="adviceList">
        ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </div>
  `;
}

function renderStash(stash) {
  const tabs = stash?.tabs ?? [];
  const files = stash?.files ?? [];
  if (!tabs.length && !files.length) return `<p class="muted">Сундук не найден.</p>`;
  return `
    <div class="cardGrid">
      ${files
        .map(
          (file) => `
            <article class="infoCard">
              <p class="eyebrow">${escapeHtml(file.file)}</p>
              <h3>${escapeHtml(file.stashName || file.stashId || "Сундук")}</h3>
              <div class="kvGrid">
                ${kv("Золото", formatNumber(file.gold ?? 0))}
                ${kv("Вкладки", displayValue(file.tabs))}
                ${kv("Материалы", displayValue(file.materials))}
                ${kv("Ключи", displayValue(file.keys))}
              </div>
            </article>
          `,
        )
        .join("")}
    </div>
    <div class="cardGrid smallCards">
      ${tabs
        .map(
          (tab) => `
            <article class="infoCard">
              <p class="eyebrow">${escapeHtml(tab.file)}</p>
              <h3>${escapeHtml(tab.displayName || tab.stashId || "Вкладка")}</h3>
              <div class="kvGrid compact">
                ${kv("Записи", displayValue(tab.itemRecords || tab.savedItems))}
                ${kv("Категория", displayValue(tab.categoryId))}
                ${kv("Размер", formatBytes(tab.size))}
              </div>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderItemCards(items) {
  const cards = items?.cards ?? [];
  if (!cards.length) {
    return `<p class="muted">Предметные записи пока не распознаны. После маппинга itemData здесь появятся базы, аффиксы и сравнение апгрейдов.</p>`;
  }
  return `
    <p class="muted">Найдено записей: ${items.totalRecords}. Карточки уже разложены как игровые предметы; неизвестные base/affix поля отмечены до подключения полного itemData mapping.</p>
    <div class="gameItemGrid">
      ${cards.map((card) => renderGameItemCard(card)).join("")}
    </div>
  `;
}

function renderFilters(filters) {
  if (!filters?.length) return `<p class="muted">Фильтры не найдены.</p>`;
  return `
    <div class="cardGrid">
      ${filters
        .map(
          (filter) => `
            <article class="infoCard">
              <p class="eyebrow">${escapeHtml(filter.file)}</p>
              <h3>${escapeHtml(filter.stats?.name ?? "Loot Filter")}</h3>
              <div class="kvGrid">
                ${kv("Правил", displayValue(filter.stats?.ruleCount))}
                ${kv("Show", displayValue(filter.stats?.showCount))}
                ${kv("Hide", displayValue(filter.stats?.hideCount))}
                ${kv("Highlight", displayValue(filter.stats?.highlightCount))}
              </div>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

async function reanalyze(id) {
  await api(`/api/snapshots/${encodeURIComponent(id)}/analyze`, { method: "POST", auth: true });
  await selectSnapshot(id);
}

async function generateFilter(id) {
  const response = await api(`/api/snapshots/${encodeURIComponent(id)}/review-filter`, { method: "POST", auth: true });
  const blob = new Blob([response.xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = response.fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function renderFilesTable(files) {
  if (!files.length) return `<p>Файлы не проанализированы.</p>`;
  return `
    <div class="tableWrap">
      <table>
        <thead>
          <tr>
            <th>Тип</th>
            <th>Путь</th>
            <th>Размер</th>
            <th>EPOCH/JSON</th>
            <th>Записи</th>
            <th>Заметки</th>
          </tr>
        </thead>
        <tbody>
          ${files
            .map(
              (file) => `
                <tr>
                  <td><span class="pill">${classificationLabel(file.classification)}</span></td>
                  <td class="pathCell">${escapeHtml(file.relativePath)}</td>
                  <td>${formatBytes(file.size)}</td>
                  <td>${file.json ? "да" : "нет"}</td>
                  <td>${displayValue(file.gameSummary?.itemRecords)}</td>
                  <td>${renderFileNotes(file)}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderFileNotes(file) {
  if (file.gameSummary?.name) return escapeHtml(file.gameSummary.name);
  if (file.gameSummary?.displayName) return escapeHtml(file.gameSummary.displayName);
  if (file.gameSummary?.stashName) return escapeHtml(file.gameSummary.stashName);
  if (file.filterStats) {
    return `${escapeHtml(file.filterStats.name)}: ${file.filterStats.ruleCount} правил`;
  }
  if (file.json) {
    return `Ключи: ${escapeHtml(file.json.topLevelKeys.join(", ") || file.json.rootType)}`;
  }
  if (file.stringPreview?.length) {
    return escapeHtml(file.stringPreview.slice(0, 3).join(", "));
  }
  return "Бинарный или неизвестный формат";
}

function renderRecommendation(item) {
  return `
    <article class="recommendation ${escapeHtml(item.severity)}">
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.body)}</p>
    </article>
  `;
}

function metric(label, value) {
  return `
    <div class="metric">
      <strong>${escapeHtml(String(value))}</strong>
      <span>${escapeHtml(label)}</span>
    </div>
  `;
}

function infoCard(title, value, body) {
  return `
    <article class="infoCard">
      <span class="metricValue">${escapeHtml(String(value))}</span>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(body)}</p>
    </article>
  `;
}

function kv(label, value) {
  return `
    <div class="kv">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </div>
  `;
}

function renderTags(values) {
  if (!values.length) return `<p class="muted">Коды скиллов пока не выделены.</p>`;
  return `<div class="tagRow">${values.map((value) => `<span class="pill info">${escapeHtml(value)}</span>`).join("")}</div>`;
}

function addDetail(label, value) {
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = label;
  dd.textContent = value;
  serverInfo.append(dt, dd);
}

async function api(path, options = {}) {
  const { auth, ...fetchOptions } = options;
  const headers = { "Content-Type": "application/json", ...(options.headers ?? {}) };
  if (auth) {
    const token = pairingToken.value.trim() || localStorage.getItem("leCompanionAccessToken");
    if (token) headers["X-Pairing-Token"] = token;
  }
  const response = await fetch(path, {
    ...fetchOptions,
    headers,
  });
  if (!response.ok) {
    throw new Error(`Запрос не выполнен: ${response.status}`);
  }
  return response.json();
}

function classificationLabel(value) {
  return (
    {
      character: "персонаж",
      stash: "сундук",
      filter: "фильтр",
      backup: "backup",
      other: "прочее",
    }[value] ?? value
  );
}

function sourceTypeLabel(value) {
  return (
    {
      character: "персонаж",
      stash: "сундук",
      "stash-tab": "вкладка",
      filter: "фильтр",
    }[value] ?? "запись"
  );
}

function decoderStatusLabel(value) {
  return (
    {
      "raw-bytes": "raw bytes",
      "metadata-only": "metadata only",
      empty: "empty",
      unknown: "unknown",
    }[value] ?? displayValue(value)
  );
}

function locationTypeLabel(value) {
  return (
    {
      equipped: "надето",
      inventory: "инвентарь",
      character: "персонаж",
      stash: "сундук",
      idol: "идол",
      unknown: "unknown",
    }[value] ?? displayValue(value)
  );
}

function comparisonStatusLabel(value) {
  return (
    {
      "comparable-slot": "slot match",
      "no-slot-match": "no slot match",
      "no-equipped-baseline": "no baseline",
    }[value] ?? displayValue(value)
  );
}

function equipmentStatusLabel(value) {
  return (
    {
      "equipment-detected": "найдена",
      "character-items-without-slots": "без слотов",
      "no-character-item-records": "нет записей",
      "pending-item-decoder": "ожидает decoder",
    }[value] ?? displayValue(value)
  );
}

function sourceLabel(source) {
  if (!source || typeof source !== "object") return "legacy";
  const companion = source.companion || source.kind || "unknown";
  const apiVersion = source.apiVersion ? `API ${source.apiVersion}` : "legacy";
  return `${companion}, ${apiVersion}`;
}

function displayValue(value) {
  return value === null || value === undefined || value === "" ? "не найдено" : value;
}

function formatDate(value) {
  if (!value) return "дата неизвестна";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatBytes(value) {
  const bytes = Number(value ?? 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("ru-RU").format(Number(value ?? 0));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}
