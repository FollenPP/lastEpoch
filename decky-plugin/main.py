import asyncio
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import tempfile
import urllib.error
import urllib.request
from zipfile import ZipFile

try:
    import decky
except Exception:  # pragma: no cover - local editor fallback only
    class _Logger:
        def info(self, message):
            print(message)

        def error(self, message):
            print(message)

    class _DeckyFallback:
        DECKY_USER_HOME = str(Path.home())
        DECKY_HOME = str(Path.home() / "homebrew")
        DECKY_PLUGIN_DIR = os.getcwd()
        DECKY_PLUGIN_SETTINGS_DIR = os.path.join(Path.home(), ".config", "last-epoch-companion")
        DECKY_PLUGIN_RUNTIME_DIR = os.path.join(Path.home(), ".local", "share", "last-epoch-companion")
        DECKY_PLUGIN_LOG_DIR = os.path.join(Path.home(), ".local", "state", "last-epoch-companion")
        logger = _Logger()

    decky = _DeckyFallback()


PLUGIN_VERSION = "0.1.6"
DEFAULT_SERVER_URL = "http://185.201.28.103"
GITHUB_LATEST_RELEASE_URL = "https://api.github.com/repos/FollenPP/lastEpoch/releases/latest"
GITHUB_LATEST_ZIP_URL = "https://github.com/FollenPP/lastEpoch/releases/latest/download/last-epoch-companion.zip"
PLUGIN_ARCHIVE_DIR = "last-epoch-companion"
PLUGIN_ARCHIVE_NAME = "last-epoch-companion.zip"
DEFAULT_GAME_ROOT = Path(decky.DECKY_USER_HOME) / ".config" / "unity3d" / "Eleventh Hour Games" / "Last Epoch"
DEFAULT_SAVES_ROOT = DEFAULT_GAME_ROOT / "Saves"
DEFAULT_FILTERS_ROOT = DEFAULT_GAME_ROOT / "Filters"
DEFAULT_SETUP_FILE = Path(decky.DECKY_USER_HOME) / "Downloads" / "last-epoch-companion-settings.json"
MAX_FILE_BYTES = 25 * 1024 * 1024

PLUGIN_SETTINGS_DIR = Path(
    getattr(
        decky,
        "DECKY_PLUGIN_SETTINGS_DIR",
        getattr(decky, "DECKY_SETTINGS_DIR", Path(decky.DECKY_USER_HOME) / ".config" / "last-epoch-companion"),
    )
)
PLUGIN_DIR = Path(getattr(decky, "DECKY_PLUGIN_DIR", Path(__file__).resolve().parent))


class Plugin:
    async def _main(self):
        PLUGIN_SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
        decky.logger.info(f"Last Epoch Companion loaded v{PLUGIN_VERSION}")
        decky.logger.info(f"Settings dir: {PLUGIN_SETTINGS_DIR}")
        decky.logger.info(f"Plugin dir: {PLUGIN_DIR}")

    async def _unload(self):
        decky.logger.info("Last Epoch Companion unloaded")

    async def get_settings(self):
        return await asyncio.to_thread(_read_settings)

    async def save_settings(self, settings):
        return await asyncio.to_thread(_write_settings, settings)

    async def import_setup_file(self):
        return await asyncio.to_thread(_import_setup_file)

    async def ping_server(self):
        settings = await asyncio.to_thread(_read_settings)
        return await asyncio.to_thread(_ping_server, settings)

    async def start_pairing(self):
        settings = await asyncio.to_thread(_read_settings)
        return await asyncio.to_thread(_start_pairing, settings)

    async def check_pairing(self):
        settings = await asyncio.to_thread(_read_settings)
        return await asyncio.to_thread(_check_pairing, settings)

    async def scan_local(self):
        settings = await asyncio.to_thread(_read_settings)
        return await asyncio.to_thread(_scan_local, settings)

    async def send_snapshot(self):
        settings = await asyncio.to_thread(_read_settings)
        return await asyncio.to_thread(_send_snapshot, settings)

    async def download_review_filter(self, snapshot_id):
        settings = await asyncio.to_thread(_read_settings)
        return await asyncio.to_thread(_download_review_filter, settings, snapshot_id)

    async def check_update(self):
        return await asyncio.to_thread(_check_update)

    async def install_latest_update(self):
        return await asyncio.to_thread(_install_latest_update)

    async def backend_self_test(self):
        settings = await asyncio.to_thread(_read_settings)
        return {
            "ok": True,
            "version": PLUGIN_VERSION,
            "serverUrl": settings["serverUrl"],
            "paired": bool(settings["pairingToken"]),
        }


def _settings_path():
    return PLUGIN_SETTINGS_DIR / "last-epoch-companion.json"


def _default_settings():
    return {
        "serverUrl": DEFAULT_SERVER_URL,
        "pairingToken": "",
        "savesRoot": str(DEFAULT_SAVES_ROOT),
        "filtersRoot": str(DEFAULT_FILTERS_ROOT),
        "setupFile": str(DEFAULT_SETUP_FILE),
        "lastSnapshotId": "",
        "pairingRequestId": "",
        "pairingCode": "",
    }


def _read_settings():
    path = _settings_path()
    if not path.exists():
        return _default_settings()
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return _default_settings()
    settings = {**_default_settings(), **loaded}
    if not str(settings.get("serverUrl", "")).strip() or "adlethome" in str(settings.get("serverUrl", "")):
        settings["serverUrl"] = DEFAULT_SERVER_URL
    return settings


def _write_settings(settings):
    current = _read_settings()
    next_settings = {
        **current,
        "serverUrl": str(settings.get("serverUrl", current["serverUrl"])).strip(),
        "pairingToken": str(settings.get("pairingToken", current["pairingToken"])).strip(),
        "savesRoot": str(settings.get("savesRoot", current["savesRoot"])).strip(),
        "filtersRoot": str(settings.get("filtersRoot", current["filtersRoot"])).strip(),
        "setupFile": str(settings.get("setupFile", current["setupFile"])).strip(),
        "lastSnapshotId": str(settings.get("lastSnapshotId", current["lastSnapshotId"])).strip(),
        "pairingRequestId": str(settings.get("pairingRequestId", current["pairingRequestId"])).strip(),
        "pairingCode": str(settings.get("pairingCode", current["pairingCode"])).strip(),
    }
    path = _settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(next_settings, indent=2), encoding="utf-8")
    return next_settings


def _import_setup_file():
    current = _read_settings()
    setup_file = Path(current.get("setupFile") or DEFAULT_SETUP_FILE).expanduser()
    if not setup_file.exists():
        raise FileNotFoundError(f"Setup file not found: {setup_file}")

    loaded = json.loads(setup_file.read_text(encoding="utf-8"))
    imported = {
        **current,
        "serverUrl": str(loaded.get("serverUrl", current["serverUrl"])).strip(),
        "pairingToken": str(loaded.get("pairingToken", current["pairingToken"])).strip(),
        "savesRoot": str(loaded.get("savesRoot", current["savesRoot"])).strip(),
        "filtersRoot": str(loaded.get("filtersRoot", current["filtersRoot"])).strip(),
        "setupFile": str(setup_file),
    }

    if not imported["serverUrl"]:
        raise ValueError("Setup file does not include serverUrl.")

    return _write_settings(imported)


def _ping_server(settings):
    url = _server_url(settings, "/api/health")
    with urllib.request.urlopen(url, timeout=8) as response:
        return json.loads(response.read().decode("utf-8"))


def _start_pairing(settings):
    payload = {
        "deckName": socket.gethostname(),
        "pluginVersion": PLUGIN_VERSION,
    }
    request = urllib.request.Request(
        _server_url(settings, "/api/device-pairings"),
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        body = json.loads(response.read().decode("utf-8"))
    pairing = body["pairing"]
    _write_settings(
        {
            **settings,
            "pairingRequestId": pairing["id"],
            "pairingCode": pairing["code"],
        }
    )
    return pairing


def _check_pairing(settings):
    request_id = settings.get("pairingRequestId")
    if not request_id:
        raise ValueError("No pairing request. Press Start Pairing first.")

    with urllib.request.urlopen(_server_url(settings, f"/api/device-pairings/{request_id}"), timeout=20) as response:
        body = json.loads(response.read().decode("utf-8"))

    pairing = body["pairing"]
    if pairing.get("deviceToken"):
        _write_settings(
            {
                **settings,
                "pairingToken": pairing["deviceToken"],
                "pairingCode": pairing.get("code", settings.get("pairingCode", "")),
            }
        )
    return pairing


def _scan_local(settings):
    saves_root = Path(settings["savesRoot"]).expanduser()
    filters_root = Path(settings["filtersRoot"]).expanduser()
    save_files = list(_iter_files(saves_root, "save"))
    filter_files = list(_iter_files(filters_root, "filter"))
    return {
        "savesRoot": str(saves_root),
        "filtersRoot": str(filters_root),
        "saveFiles": len(save_files),
        "filterFiles": len(filter_files),
        "totalBytes": sum(file["size"] for file in save_files + filter_files),
    }


def _send_snapshot(settings):
    files = []
    saves_root = Path(settings["savesRoot"]).expanduser()
    filters_root = Path(settings["filtersRoot"]).expanduser()
    files.extend(_read_payload_files(saves_root, "save"))
    files.extend(_read_payload_files(filters_root, "filter"))

    payload = {
        "deckName": socket.gethostname(),
        "pluginVersion": PLUGIN_VERSION,
        "createdAt": _utc_now_iso(),
        "savesRoot": str(saves_root),
        "filtersRoot": str(filters_root),
        "files": files,
    }
    request = urllib.request.Request(
        _server_url(settings, "/api/snapshots"),
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-Pairing-Token": settings["pairingToken"],
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        result = json.loads(response.read().decode("utf-8"))
    if result.get("snapshot", {}).get("id"):
        _write_settings({**settings, "lastSnapshotId": result["snapshot"]["id"]})
    return result


def _download_review_filter(settings, snapshot_id):
    request = urllib.request.Request(
        _server_url(settings, f"/api/snapshots/{snapshot_id}/review-filter"),
        data=b"{}",
        headers={
            "Content-Type": "application/json",
            "X-Pairing-Token": settings["pairingToken"],
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        body = json.loads(response.read().decode("utf-8"))

    filters_root = Path(settings["filtersRoot"]).expanduser()
    filters_root.mkdir(parents=True, exist_ok=True)
    file_name = _safe_file_name(body["fileName"])
    output_path = filters_root / file_name
    output_path.write_text(body["xml"], encoding="utf-8")
    return {
        "fileName": file_name,
        "path": str(output_path),
    }


def _check_update():
    release = _fetch_latest_release()
    latest_version = str(release.get("tag_name", "")).lstrip("v")
    asset_url = _find_release_asset_url(release) or GITHUB_LATEST_ZIP_URL
    update_available = _version_tuple(latest_version) > _version_tuple(PLUGIN_VERSION)
    return {
        "currentVersion": PLUGIN_VERSION,
        "latestVersion": latest_version,
        "updateAvailable": update_available,
        "releaseUrl": release.get("html_url", ""),
        "assetUrl": asset_url,
    }


def _install_latest_update():
    update = _check_update()
    if not update["updateAvailable"]:
        return {**update, "installed": False, "requiresRestart": False}

    with tempfile.TemporaryDirectory(prefix="le-companion-update-") as temp_dir:
        temp_path = Path(temp_dir)
        zip_path = temp_path / PLUGIN_ARCHIVE_NAME
        _download_file(update["assetUrl"], zip_path)

        extract_dir = temp_path / "extract"
        extract_dir.mkdir()
        with ZipFile(zip_path) as archive:
            archive.extractall(extract_dir)

        source_dir = _find_plugin_source_dir(extract_dir)
        target_dir = PLUGIN_DIR
        _copy_plugin_files(source_dir, target_dir)

    return {**update, "installed": True, "requiresRestart": True}


def _fetch_latest_release():
    request = urllib.request.Request(
        GITHUB_LATEST_RELEASE_URL,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": f"LastEpochCompanionDecky/{PLUGIN_VERSION}",
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def _find_release_asset_url(release):
    for asset in release.get("assets", []):
        if asset.get("name") == PLUGIN_ARCHIVE_NAME:
            return asset.get("browser_download_url")
    return None


def _download_file(url, destination):
    request = urllib.request.Request(
        url,
        headers={"User-Agent": f"LastEpochCompanionDecky/{PLUGIN_VERSION}"},
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        destination.write_bytes(response.read())


def _find_plugin_source_dir(extract_dir):
    direct = extract_dir / PLUGIN_ARCHIVE_DIR
    candidates = [direct, extract_dir]
    for candidate in candidates:
        if (candidate / "plugin.json").exists() and (candidate / "main.py").exists() and (candidate / "dist" / "index.js").exists():
            return candidate
    raise ValueError("Downloaded plugin archive has an unexpected layout.")


def _copy_plugin_files(source_dir, target_dir):
    for name in ["plugin.json", "package.json", "main.py", "README.md", "LICENSE"]:
        source = source_dir / name
        if source.exists():
            shutil.copy2(source, target_dir / name)

    source_dist = source_dir / "dist"
    target_dist = target_dir / "dist"
    if target_dist.exists():
        shutil.rmtree(target_dist)
    shutil.copytree(source_dist, target_dist)


def _version_tuple(value):
    parts = []
    for part in str(value).split("."):
        digits = "".join(char for char in part if char.isdigit())
        parts.append(int(digits or "0"))
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:3])


def _read_payload_files(root, kind):
    files = []
    for meta in _iter_files(root, kind):
        file_path = Path(meta["absolutePath"])
        content = file_path.read_bytes()
        files.append(
            {
                "kind": kind,
                "relativePath": meta["relativePath"],
                "size": meta["size"],
                "mtimeMs": meta["mtimeMs"],
                "sha256": hashlib.sha256(content).hexdigest(),
                "contentBase64": base64.b64encode(content).decode("ascii"),
            }
        )
    return files


def _iter_files(root, kind):
    root = Path(root).expanduser()
    if not root.exists() or not root.is_dir():
        return
    for file_path in root.rglob("*"):
        if not file_path.is_file() or file_path.is_symlink():
            continue
        stat = file_path.stat()
        if stat.st_size > MAX_FILE_BYTES:
            continue
        if kind == "filter" and file_path.suffix.lower() != ".xml":
            continue
        yield {
            "absolutePath": str(file_path),
            "relativePath": file_path.relative_to(root).as_posix(),
            "size": stat.st_size,
            "mtimeMs": int(stat.st_mtime * 1000),
        }


def _server_url(settings, suffix):
    base = str(settings.get("serverUrl", "")).strip().rstrip("/")
    if not base:
        raise ValueError("Server URL is not configured.")
    return f"{base}{suffix}"


def _safe_file_name(value):
    return "".join(char for char in str(value) if char.isalnum() or char in "._-") or "DeckCompanion.xml"


def _utc_now_iso():
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
