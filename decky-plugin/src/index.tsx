import { callable, definePlugin, toaster } from "@decky/api";
import { Field, PanelSection, PanelSectionRow } from "@decky/ui";
import { useEffect, useState } from "react";
import { FaCloudUploadAlt } from "react-icons/fa";

type Settings = {
  serverUrl: string;
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

const getSettings = callable<[], Settings>("get_settings");
const saveSettings = callable<[settings: Settings], Settings>("save_settings");
const importSetupFile = callable<[], Settings>("import_setup_file");
const pingServer = callable<[], { ok: boolean }>("ping_server");
const startPairing = callable<[], { id: string; code: string; status: string; expiresAt: string }>("start_pairing");
const checkPairing = callable<[], { id: string; code: string; status: string; deviceToken?: string | null }>("check_pairing");
const scanLocal = callable<[], ScanResult>("scan_local");
const sendSnapshot = callable<[], SendResult>("send_snapshot");
const downloadReviewFilter = callable<[snapshotId: string], { fileName: string; path: string }>("download_review_filter");

const defaultSavesRoot = "/home/deck/.config/unity3d/Eleventh Hour Games/Last Epoch/Saves";
const defaultFiltersRoot = "/home/deck/.config/unity3d/Eleventh Hour Games/Last Epoch/Filters";
const defaultServerUrl = "https://le.adlethome.ru";

function Content() {
  const [settings, setSettings] = useState<Settings>({
    serverUrl: "",
    pairingToken: "",
    savesRoot: defaultSavesRoot,
    filtersRoot: defaultFiltersRoot,
    setupFile: "/home/deck/Downloads/last-epoch-companion-settings.json",
    lastSnapshotId: "",
    pairingRequestId: "",
    pairingCode: "",
  });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Send setup file from laptop, then press Load Setup File.");
  const [selfTestCount, setSelfTestCount] = useState(0);

  useEffect(() => {
    getSettings()
      .then((loaded) => {
        setSettings(loaded);
        setStatus(loaded.pairingToken ? "Paired. Send a snapshot when ready." : "Start pairing or load setup file.");
      })
      .catch((error: unknown) => setStatus(errorMessage(error)));
  }, []);

  const loadSetup = async () => {
    setBusy(true);
    try {
      const loaded = await importSetupFile();
      setSettings(loaded);
      setStatus("Setup loaded. Test the server next.");
      toaster.toast({
        title: "Last Epoch Companion",
        body: "Laptop setup loaded.",
      });
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const ping = async () => {
    setBusy(true);
    try {
      await pingServer();
      setStatus("Server is reachable.");
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const startDevicePairing = async () => {
    setBusy(true);
    try {
      const result = await startPairing();
      const loaded = await getSettings();
      setSettings(loaded);
      setStatus(`Pairing code ${result.code}. Approve this Deck in the web UI.`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const checkDevicePairing = async () => {
    setBusy(true);
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
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const scan = async () => {
    setBusy(true);
    try {
      const result = await scanLocal();
      setStatus(`Found ${result.saveFiles} save file(s), ${result.filterFiles} filter file(s), ${formatBytes(result.totalBytes)} total.`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    setBusy(true);
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
      setStatus(errorMessage(error));
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
    try {
      const result = await downloadReviewFilter(settings.lastSnapshotId);
      setStatus(`Saved ${result.fileName} to Filters.`);
      toaster.toast({
        title: "Last Epoch Companion",
        body: "Review filter saved.",
      });
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const resetPaths = async () => {
    setBusy(true);
    try {
      const saved = await saveSettings({
        ...settings,
        savesRoot: defaultSavesRoot,
        filtersRoot: defaultFiltersRoot,
      });
      setSettings(saved);
      setStatus("Last Epoch paths reset.");
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
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
      </PanelSection>

      <PanelSection title="Setup">
        <PanelSectionRow>
          <Field label="Setup file" description={shortPath(settings.setupFile)} focusable={false} />
        </PanelSectionRow>
        <PanelSectionRow>
          <ActionField label="Load Setup File" description="Read settings from Downloads" disabled={busy} onAction={loadSetup} />
        </PanelSectionRow>
        <PanelSectionRow>
          <Field label="Server" description={settings.serverUrl || defaultServerUrl} focusable={false} />
        </PanelSectionRow>
        <PanelSectionRow>
          <Field label="Device token" description={settings.pairingToken ? "Paired" : "Not paired"} focusable={false} />
        </PanelSectionRow>
        <PanelSectionRow>
          <ActionField label="Start Pairing" description="Create approval request" disabled={busy || !settings.serverUrl} onAction={startDevicePairing} />
        </PanelSectionRow>
        <PanelSectionRow>
          <ActionField label="Check Pairing" description={settings.pairingCode ? `Code ${settings.pairingCode}` : "No pairing request yet"} disabled={busy || !settings.pairingRequestId} onAction={checkDevicePairing} />
        </PanelSectionRow>
        <PanelSectionRow>
          <ActionField label="Test Server" description="Check laptop/VPS API" disabled={busy || !settings.serverUrl} onAction={ping} />
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
          <ActionField label="Send Snapshot" description="Upload to analyzer" disabled={busy || !settings.serverUrl || !settings.pairingToken} onAction={send} />
        </PanelSectionRow>
        <PanelSectionRow>
          <ActionField label="Download Review Filter" description="Save generated filter" disabled={busy || !settings.lastSnapshotId} onAction={downloadFilter} />
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
    <Field
      label={label}
      description={disabled ? "Unavailable right now" : description}
      focusable={!disabled}
      highlightOnFocus
      onActivate={handleAction}
      onClick={handleAction}
    />
  );
}

export default definePlugin(() => ({
  name: "Last Epoch Companion",
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
  return error instanceof Error ? error.message : String(error);
}
