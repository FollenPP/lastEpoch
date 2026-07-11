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
  return `
    <div class="summaryGrid">
      ${metric("Полнота данных", `${buildAnalysis.metrics?.parseCompleteness ?? 0}%`)}
      ${metric("Уверенность", `${buildAnalysis.metrics?.confidence ?? 0}%`)}
      ${metric("Прокачка", `${buildAnalysis.metrics?.progressionReadiness ?? 0}%`)}
      ${metric("Защита", `${buildAnalysis.metrics?.defensiveReadiness ?? 0}%`)}
      ${metric("Скиллы", `${buildAnalysis.metrics?.skillReadiness ?? 0}%`)}
      ${metric("Stash", `${buildAnalysis.metrics?.stashReadiness ?? 0}%`)}
      ${metric("Game data", `${buildAnalysis.metrics?.knowledgeReadiness ?? 0}%`)}
    </div>
    ${renderBuildProfile(buildAnalysis.model?.knowledge, buildAnalysis.model?.gameData)}
    ${renderEquipmentModel(activeCharacter(buildAnalysis.model))}
    <div class="analysisColumns">
      <div>
        <h3>Проблемы</h3>
        ${renderIssues(buildAnalysis.issues ?? [])}
      </div>
      <div>
        <h3>Рекомендации</h3>
        ${renderBuildRecommendations(buildAnalysis.recommendations ?? [])}
      </div>
    </div>
    <div class="section">
      <h3>План развития</h3>
      ${renderPlan(buildAnalysis.plan?.steps ?? [])}
    </div>
    <div class="section">
      <h3>Кандидаты из stash</h3>
      ${renderUpgradeCandidates(buildAnalysis.model?.stash?.upgradeCandidates ?? [])}
    </div>
  `;
}

function activeCharacter(model) {
  if (!model) return null;
  return model.characters?.find((character) => character.id === model.activeCharacterId) ?? model.characters?.[0] ?? null;
}

function renderEquipmentModel(character) {
  const equipment = character?.equipment;
  if (!equipment) {
    return `<div class="section"><h3>Экипировка</h3><p class="muted">Экипировка появится после распознавания active character.</p></div>`;
  }
  const equippedItems = equipment.equippedItems ?? [];
  const inventoryItems = equipment.inventoryItems ?? [];
  return `
    <div class="section">
      <h3>Экипировка</h3>
      <div class="summaryGrid">
        ${metric("Надето", equippedItems.length)}
        ${metric("В персонаже", equipment.rawItemRecords ?? 0)}
        ${metric("Инвентарь", inventoryItems.length)}
        ${metric("Статус", equipmentStatusLabel(equipment.status))}
      </div>
      ${
        equippedItems.length
          ? `<div class="itemGrid">${equippedItems.slice(0, 12).map(renderEquipmentItem).join("")}</div>`
          : `<p class="muted">Предметные записи персонажа найдены не во всех сейвах одинаково. Если список пустой, следующий шаг - калибровка по реальному sample save.</p>`
      }
    </div>
  `;
}

function renderEquipmentItem(item) {
  return `
    <article class="itemCard">
      <div class="cardTop">
        <h3>${escapeHtml(item.equipmentSlot || item.itemKind || "slot unknown")}</h3>
        <span class="pill info">score ${displayValue(item.score)}</span>
      </div>
      <p class="muted">${escapeHtml(item.sourceName || item.source || item.id)}</p>
      <div class="kvGrid compact">
        ${kv("Location", locationTypeLabel(item.locationType))}
        ${kv("Fingerprint", displayValue(item.fingerprint))}
        ${kv("Data", displayValue(item.dataLength))}
        ${kv("Path", displayValue(item.recordPath))}
      </div>
    </article>
  `;
}

function renderBuildProfile(profile, gameData) {
  if (!profile) {
    return `<div class="section"><p class="muted">Профиль билда появится после распознавания персонажа.</p></div>`;
  }
  return `
    <div class="section">
      <h3>Профиль билда</h3>
      <div class="cardGrid smallCards">
        ${infoCard("Архетип", profile.archetype?.name ?? "не распознан", `Уверенность game-data слоя: ${Math.round((profile.confidence ?? 0) * 100)}%.`)}
        ${infoCard("Фаза", profile.phase === "endgame" ? "endgame" : "прокачка", `База знаний: ${gameData?.version ?? profile.version ?? "starter"}.`)}
        ${infoCard("Damage tags", profile.tags?.damage?.join(", ") || "не найдены", "Теги из активных навыков, по которым стоит фильтровать урон и идолы.")}
        ${infoCard("Utility", profile.tags?.utility?.join(", ") || "не найдена", "Movement/sustain/utility сигналы из skill bar.")}
      </div>
      ${renderPriorityList(profile.priorities ?? [])}
    </div>
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
    <div class="itemGrid">
      ${candidates
        .slice(0, 12)
        .map(
          (item) => `
            <article class="itemCard">
              <div class="cardTop">
                <h3>${escapeHtml(item.sourceName || item.source || item.id)}</h3>
                <span class="pill info">score ${displayValue(item.score)}</span>
              </div>
              <p>${escapeHtml(item.reason ?? "Кандидат из stash.")}</p>
              <div class="kvGrid compact">
                ${kv("Источник", sourceTypeLabel(item.sourceType))}
                ${kv("Позиция", escapeHtml(item.inventoryPosition || "не найдена"))}
                ${kv("Slot", displayValue(item.comparison?.slot ?? item.equipmentSlot ?? item.itemKind))}
                ${kv("Compare", comparisonStatusLabel(item.comparison?.status))}
                ${kv("Delta", displayValue(item.comparison?.scoreDelta))}
                ${kv("Data", displayValue(item.dataLength))}
                ${kv("Fingerprint", displayValue(item.fingerprint))}
                ${kv("Status", decoderStatusLabel(item.decoderStatus))}
                ${kv("Уверенность", escapeHtml(item.confidence ?? "low"))}
              </div>
            </article>
          `,
        )
        .join("")}
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
    <p class="muted">Найдено записей: ${items.totalRecords}. Сейчас это технические карточки itemData; следующий слой - расшифровка базы предмета и аффиксов.</p>
    <div class="itemGrid">
      ${cards
        .map(
          (card, index) => `
            <article class="itemCard">
              <div class="cardTop">
                <h3>Предмет #${index + 1}</h3>
                <span class="pill info">${sourceTypeLabel(card.sourceType)}</span>
              </div>
              <p class="muted">${escapeHtml(card.sourceName || card.source)}</p>
              <div class="kvGrid compact">
                ${kv("Кол-во", displayValue(card.quantity))}
                ${kv("Контейнер", displayValue(card.containerId))}
                ${kv("Позиция", escapeHtml(card.inventoryPosition || "не найдена"))}
                ${kv("Версия", displayValue(card.formatVersion))}
                ${kv("Data", displayValue(card.dataLength))}
                ${kv("Score", displayValue(card.score))}
                ${kv("Location", locationTypeLabel(card.locationType))}
                ${kv("Slot", displayValue(card.equipmentSlot ?? card.itemKind))}
                ${kv("Fingerprint", displayValue(card.fingerprint))}
                ${kv("Status", decoderStatusLabel(card.decoderStatus))}
                ${kv("Hex", displayValue(card.decoded?.previewHex))}
                ${kv("Path", displayValue(card.recordPath))}
                ${kv("Checksum", displayValue(card.decoded?.checksum))}
              </div>
            </article>
          `,
        )
        .join("")}
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
