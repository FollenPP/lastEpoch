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
  const response = await api(`/api/snapshots/${encodeURIComponent(id)}`, { auth: true });
  renderSnapshotDetail(response.snapshot, response.analysis);
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

function renderSnapshotDetail(snapshot, analysis) {
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
