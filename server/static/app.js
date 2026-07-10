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
  toggleToken.textContent = state.tokenVisible ? "Hide" : "Show";
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
  addDetail("Local", `${location.origin}`);
  addDetail("LAN", health.lanUrls?.join("\n") || "No LAN IPv4 found");
  addDetail("Data", health.dataDir);
}

async function loadPairingToken() {
  try {
    const response = await api("/api/pairing");
    pairingToken.value = response.pairingToken;
    localStorage.setItem("leCompanionAccessToken", response.pairingToken);
  } catch {
    if (!pairingToken.value) pairingToken.placeholder = "Enter server admin token";
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
    pairingList.innerHTML = `<p class="snapshotMeta">Save access token to view pairings.</p>`;
  }
}

function renderSnapshots() {
  snapshotList.innerHTML = "";
  if (state.snapshots.length === 0) {
    snapshotList.innerHTML = `<p class="muted">No snapshots yet.</p>`;
    return;
  }

  const template = document.querySelector("#snapshotButtonTemplate");
  for (const snapshot of state.snapshots) {
    const node = template.content.cloneNode(true);
    const button = node.querySelector(".snapshotButton");
    button.classList.toggle("active", snapshot.id === state.selectedId);
    node.querySelector(".snapshotTitle").textContent = snapshot.deckName || "Steam Deck";
    node.querySelector(".snapshotMeta").textContent = `${formatDate(snapshot.createdAt)} - ${snapshot.fileCount} files`;
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
    pairingList.innerHTML = `<p class="snapshotMeta">No pending devices.</p>`;
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
  snapshotDetail.innerHTML = `
    <div class="sectionHeader">
      <div>
        <p class="eyebrow">${escapeHtml(snapshot.deckName ?? "Steam Deck")}</p>
        <h2>Snapshot ${escapeHtml(snapshot.id)}</h2>
      </div>
      <div class="actionRow">
        <button id="reanalyzeButton">Reanalyze</button>
        <button id="filterButton" class="primary">Generate Review Filter</button>
      </div>
    </div>

    <section class="summaryGrid">
      ${metric("Files", summary.totalFiles ?? snapshot.fileCount ?? 0)}
      ${metric("Characters", summary.characterFiles ?? 0)}
      ${metric("Stash", summary.stashFiles ?? 0)}
      ${metric("Filters", summary.filterFiles ?? 0)}
      ${metric("Readable", `${summary.parserCoverage ?? 0}%`)}
      ${metric("Signals", summary.itemSignalCount ?? 0)}
    </section>

    <section class="section">
      <h2>Recommendations</h2>
      <div class="recommendations">
        ${(analysis?.recommendations ?? []).map(renderRecommendation).join("")}
      </div>
    </section>

    <section class="section">
      <h2>Detected Files</h2>
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
  if (!files.length) return `<p>No files analyzed.</p>`;
  return `
    <div class="tableWrap">
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Path</th>
            <th>Size</th>
            <th>Readable</th>
            <th>Signals</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${files
            .map(
              (file) => `
                <tr>
                  <td><span class="pill">${escapeHtml(file.classification)}</span></td>
                  <td class="pathCell">${escapeHtml(file.relativePath)}</td>
                  <td>${formatBytes(file.size)}</td>
                  <td>${file.readable ? "Yes" : "No"}</td>
                  <td>${file.itemSignalCount}</td>
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
  if (file.filterStats) {
    return `${escapeHtml(file.filterStats.name)}: ${file.filterStats.ruleCount} rule(s)`;
  }
  if (file.json) {
    return `JSON keys: ${escapeHtml(file.json.topLevelKeys.join(", ") || file.json.rootType)}`;
  }
  if (file.stringPreview?.length) {
    return escapeHtml(file.stringPreview.slice(0, 3).join(", "));
  }
  return "Binary or unknown format";
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
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

function formatDate(value) {
  if (!value) return "unknown date";
  return new Intl.DateTimeFormat(undefined, {
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}
