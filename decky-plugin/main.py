import asyncio
import base64
import hashlib
import json
import os
from pathlib import Path
import socket
import urllib.error
import urllib.request

try:
    import decky
except Exception:  # pragma: no cover - local editor fallback only
    class _Logger:
        def info(self, message):
            print(message)

        def error(self, message):
            print(message)

    class _DeckyFallback:
        DECKY_SETTINGS_DIR = os.path.join(Path.home(), ".config", "last-epoch-companion")
        DECKY_USER_HOME = str(Path.home())
        logger = _Logger()

    decky = _DeckyFallback()


PLUGIN_VERSION = "0.1.0"
DEFAULT_SERVER_URL = "https://le.adlethome.ru"
DEFAULT_GAME_ROOT = Path(decky.DECKY_USER_HOME) / ".config" / "unity3d" / "Eleventh Hour Games" / "Last Epoch"
DEFAULT_SAVES_ROOT = DEFAULT_GAME_ROOT / "Saves"
DEFAULT_FILTERS_ROOT = DEFAULT_GAME_ROOT / "Filters"
DEFAULT_SETUP_FILE = Path(decky.DECKY_USER_HOME) / "Downloads" / "last-epoch-companion-settings.json"
MAX_FILE_BYTES = 25 * 1024 * 1024


class Plugin:
    async def _main(self):
        Path(decky.DECKY_SETTINGS_DIR).mkdir(parents=True, exist_ok=True)
        decky.logger.info("Last Epoch Companion loaded")

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


def _settings_path():
    return Path(decky.DECKY_SETTINGS_DIR) / "last-epoch-companion.json"


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
    return {**_default_settings(), **loaded}


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
    if not imported["pairingToken"]:
        raise ValueError("Setup file does not include pairingToken.")

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
