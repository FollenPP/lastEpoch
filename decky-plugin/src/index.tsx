import { callable, definePlugin, toaster } from "@decky/api";
import { ButtonItem, Field, PanelSection, PanelSectionRow } from "@decky/ui";
import { useEffect, useState } from "react";
import { FaCloudUploadAlt } from "react-icons/fa";

type Settings = {
  settingsVersion: number;
  serverUrl: string;
  serverUrlSource: string;
  pairingToken: string;
  savesRoot: string;
  filtersRoot: string;
  setupFile: string;
  lastSnapshotId: string;
  pairingRequestId: string;
  pairingCode: string;
};

type ScanResult = {
  saveFiles: number;
  filterFiles: number;
  totalBytes: number;
};

type SendResult = {
  snapshot: {
    id: string;
    fileCount: number;
  };
  analysis: {
    summary: {
      characterFiles: number;
      stashFiles: number;
      filterFiles: number;
    };
  };
};

type UpdateInfo = {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
  assetUrl: string;
  installed?: boolean;
  requiresRestart?: boolean;
};

const getSettings = callable<[], Settings>("get_settings");
const saveSettings = callable<[settings: Settings], Settings>("save_settings");
const resetServerUrl = callable<[], Settings>("reset_server_url");
const pingServer = callable<[], { ok: boolean }>("ping_server");
const startPairing = callable<[], { id: string; code: string; status: string; expiresAt: string }>("start_pairing");
const checkPairing = callable<[], { id: string; code: string; status: string; deviceToken?: string | null }>("check_pairing");
const scanLocal = callable<[], ScanResult>("scan_local");
const sendSnapshot = callable<[], SendResult>("send_snapshot");
const downloadReviewFilter = callable<[snapshotId: string], { fileName: string; path: string }>("download_review_filter");
const checkUpdate = callable<[], UpdateInfo>("check_update");
const installLatestUpdate = callable<[], UpdateInfo>("install_latest_update");
const backendSelfTest = callable<[], { ok: boolean; version: string; serverUrl: string; paired: boolean }>("backend_self_test");

const defaultSavesRoot = "/home/deck/.config/unity3d/Eleventh Hour Games/Last Epoch/Saves";
const defaultFiltersRoot = "/home/deck/.config/unity3d/Eleventh Hour Games/Last Epoch/Filters";
const defaultServerUrl = "http://185.201.28.103";
const pluginVersion = "0.1.8";

function Content() {
  const [settings, setSettings] = useState<Settings>({
    settingsVersion: 2,
    serverUrl: defaultServerUrl,
    serverUrlSource: "default",
    pairingToken: "",
    savesRoot: defaultSavesRoot,
    filtersRoot: defaultFiltersRoot,
    setupFile: "/home/deck/Downloads/last-epoch-companion-settings.json",
    lastSnapshotId: "",
    pairingRequestId: "",
    pairingCode: "",
  });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Server is hardcoded. Start pairing when ready.");
  const [selfTestCount, setSelfTestCount] = useState(0);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    getSettings()
      .then((loaded) => {
        const nextSettings = { ...loaded, serverUrl: loaded.serverUrl || defaultServerUrl };
        setSettings(nextSettings);
        setStatus(loaded.pairingToken ? "Paired. Send a snapshot when ready." : "Start pairing when ready.");
      })
      .catch((error: unknown) => setStatus(errorMessage(error)));
  }, []);

  const ping = async () => {
    setBusy(true);
    setStatus("Testing server...");
    try {
      await pingServer();
      setStatus("Server is reachable.");
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const startDevicePairing = async () => {
    setBusy(true);
    setStatus("Creating pairing request...");
    try {
      const result = await startPairing();
      const loaded = await getSettings();
      setSettings(loaded);
      setStatus(`Pairing code ${result.code}. Approve this Deck in the web UI.`);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const checkDevicePairing = async () => {
    setBusy(true);
    setStatus("Checking pairing request...");
    try {
      const result = await checkPairing();
      const loaded = await getSettings();
      setSettings(loaded);
      if (result.deviceToken) {
        setStatus("Pairing approved. Device token saved.");
      } else {
        setStatus(`Pairing is ${result.status}. Approve code ${result.code} in the web UI.`);
      }
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const scan = async () => {
    setBusy(true);
    setStatus("Scanning Last Epoch files...");
    try {
      const result = await scanLocal();
      setStatus(`Found ${result.saveFiles} save file(s), ${result.filterFiles} filter file(s), ${formatBytes(result.totalBytes)} total.`);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    setBusy(true);
    setStatus("Sending snapshot...");
    try {
      const result = await sendSnapshot();
      const nextSettings = { ...settings, lastSnapshotId: result.snapshot.id };
      setSettings(nextSettings);
      setStatus(
        `Sent ${result.snapshot.fileCount} file(s). Characters: ${result.analysis.summary.characterFiles}, stash: ${result.analysis.summary.stashFiles}, filters: ${result.analysis.summary.filterFiles}.`,
      );
      toaster.toast({
        title: "Last Epoch Companion",
        body: "Snapshot sent to laptop.",
      });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const downloadFilter = async () => {
    if (!settings.lastSnapshotId) {
      setStatus("Send a snapshot first.");
      return;
    }
    setBusy(true);
    setStatus("Downloading review filter...");
    try {
      const result = await downloadReviewFilter(settings.lastSnapshotId);
      setStatus(`Saved ${result.fileName} to Filters.`);
      toaster.toast({
        title: "Last Epoch Companion",
        body: "Review filter saved.",
      });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const resetPaths = async () => {
    setBusy(true);
    setStatus("Resetting paths...");
    try {
      const saved = await saveSettings({
        ...settings,
        savesRoot: defaultSavesRoot,
        filtersRoot: defaultFiltersRoot,
      });
      setSettings(saved);
      setStatus("Last Epoch paths reset.");
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const useVpsServer = async () => {
    setBusy(true);
    setStatus("Resetting pairing and keeping hardcoded server...");
    try {
      const saved = await resetServerUrl();
      setSettings(saved);
      setStatus("Pairing reset. Start pairing again.");
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const checkForUpdates = async () => {
    setBusy(true);
    setStatus("Checking GitHub releases...");
    try {
      const result = await checkUpdate();
      setUpdateInfo(result);
      setStatus(
        result.updateAvailable
          ? `Update available: ${result.currentVersion} -> ${result.latestVersion}.`
          : `Plugin is up to date: ${result.currentVersion}.`,
      );
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const installUpdate = async () => {
    setBusy(true);
    setStatus("Installing latest plugin release...");
    try {
      const result = await installLatestUpdate();
      setUpdateInfo(result);
      setStatus(
        result.installed
          ? `Installed ${result.latestVersion}. Restart Decky or reboot Steam Deck.`
          : `Already up to date: ${result.currentVersion}.`,
      );
      toaster.toast({
        title: "Last Epoch Companion",
        body: result.installed ? "Update installed. Restart Decky." : "Already up to date.",
      });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const runBackendSelfTest = async () => {
    setBusy(true);
    setStatus("Calling Python backend...");
    try {
      const result = await backendSelfTest();
      setStatus(`Backend OK. v${result.version}, ${result.serverUrl}, ${result.paired ? "paired" : "not paired"}.`);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const showError = (error: unknown) => {
    const message = errorMessage(error);
    setStatus(message);
    toaster.toast({
      title: "Last Epoch Companion",
      body: message,
    });
  };

  return (
    <>
      <PanelSection title="Diagnostics">
        <PanelSectionRow>
          <ActionField
            label="UI Self Test"
            description={`Pressed ${selfTestCount} time(s)`}
            disabled={busy}
            onAction={() => {
              setSelfTestCount((value) => value + 1);
              setStatus("UI self test worked.");
            }}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ActionField label="Backend Self Test" description="Call Python backend" disabled={busy} onAction={runBackendSelfTest} />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Setup">
        <PanelSectionRow>
          <Field label="Server" description={`${settings.serverUrl} (${settings.serverUrlSource || "manual"})`} focusable={false} />
        </PanelSectionRow>
        <PanelSectionRow>
          <ActionField label="Reset Pairing" description={`Keep ${defaultServerUrl}`} disabled={busy} onAction={useVpsServer} />
        </PanelSectionRow>
        <PanelSectionRow>
          <Field label="Device token" description={settings.pairingToken ? "Paired" : "Not paired"} focusable={false} />
        </PanelSectionRow>
        <PanelSectionRow>
          <ActionField label="Start Pairing" description="Create approval request" disabled={busy} onAction={startDevicePairing} />
        </PanelSectionRow>
        <PanelSectionRow>
          <ActionField label="Check Pairing" description={settings.pairingCode ? `Code ${settings.pairingCode}` : "No pairing request yet"} disabled={busy || !settings.pairingRequestId} onAction={checkDevicePairing} />
        </PanelSectionRow>
        <PanelSectionRow>
          <ActionField label="Test Server" description="Check laptop/VPS API" disabled={busy} onAction={ping} />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Snapshot">
        <PanelSectionRow>
          <Field label="Saves" description={shortPath(settings.savesRoot)} focusable={false} />
        </PanelSectionRow>
        <PanelSectionRow>
          <Field label="Filters" description={shortPath(settings.filtersRoot)} focusable={false} />
        </PanelSectionRow>
        <PanelSectionRow>
          <ActionField label="Reset Game Paths" description="Use default Last Epoch offline paths" disabled={busy} onAction={resetPaths} />
        </PanelSectionRow>
        <PanelSectionRow>
          <ActionField label="Scan Local Files" description="Count saves and filters" disabled={busy} onAction={scan} />
        </PanelSectionRow>
        <PanelSectionRow>
          <ActionField label="Send Snapshot" description="Upload to analyzer" disabled={busy || !settings.pairingToken} onAction={send} />
        </PanelSectionRow>
        <PanelSectionRow>
          <ActionField label="Download Review Filter" description="Save generated filter" disabled={busy || !settings.lastSnapshotId} onAction={downloadFilter} />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Updates">
        <PanelSectionRow>
          <Field
            label="Installed"
            description={updateInfo ? `Current ${updateInfo.currentVersion}, latest ${updateInfo.latestVersion}` : "Press Check Updates"}
            focusable={false}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ActionField label="Check Updates" description="Read latest GitHub release" disabled={busy} onAction={checkForUpdates} />
        </PanelSectionRow>
        <PanelSectionRow>
          <ActionField
            label="Install Latest"
            description={updateInfo?.updateAvailable ? `Install ${updateInfo.latestVersion}` : "Check updates first"}
            disabled={busy || !updateInfo?.updateAvailable}
            onAction={installUpdate}
          />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Status">
        <PanelSectionRow>
          <Field label={busy ? "Working" : "Last result"} description={status} focusable={false} />
        </PanelSectionRow>
      </PanelSection>
    </>
  );
}

type ActionFieldProps = {
  label: string;
  description: string;
  disabled?: boolean;
  onAction: () => void | Promise<void>;
};

function ActionField({ label, description, disabled, onAction }: ActionFieldProps) {
  const handleAction = () => {
    if (!disabled) {
      void onAction();
    }
  };

  return (
    <ButtonItem
      label={label}
      description={disabled ? "Unavailable right now" : description}
      highlightOnFocus
      onClick={handleAction}
      disabled={disabled}
    />
  );
}

export default definePlugin(() => ({
  name: "Last Epoch Companion",
  version: pluginVersion,
  titleView: <div>Last Epoch Companion</div>,
  content: <Content />,
  icon: <FaCloudUploadAlt />,
}));

function shortPath(value: string) {
  return value
    .replace("/home/deck/", "~/")
    .replace("/.config/unity3d/Eleventh Hour Games/Last Epoch/", "/Last Epoch/");
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error) {
    const maybeMessage = "message" in error ? error.message : undefined;
    if (typeof maybeMessage === "string") return maybeMessage;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}
