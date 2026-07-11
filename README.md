# Last Epoch Deck Companion

Companion for **Last Epoch Full Offline** on Steam Deck.

This repo is also the first working slice of the larger **Last Epoch Build Analyzer** idea: Decky is the Steam Deck companion-adapter, and the server is the web analyzer that stores snapshots, parses saves/stash/filters, and renders recommendations.

The project has two parts:

- `server/`: laptop-side local web app and snapshot API.
- `decky-plugin/`: Steam Deck Decky plugin that sends saves, stash files, and loot filters to the laptop with one button.

See [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md) for the Decky integration contract with the future full build analyzer.

The server is intentionally dependency-free. It stores uploaded snapshots locally and never needs the game installed on the laptop.

For production without a domain, run the server on a VPS at `http://185.201.28.103`. The Decky plugin can pair with it without typing on Steam Deck, then send snapshots from any network.

## Run the Laptop Server

```bash
npm start
```

The server prints:

- local browser URL, usually `http://127.0.0.1:8787`
- LAN URLs, for example `http://192.168.1.50:8787`
- pairing token for the Decky plugin

Open the local URL on the laptop for the full UI.

## Configure the Decky Plugin Without Typing

For local development, the server writes a ready-to-import setup file:

```text
server/static/downloads/last-epoch-companion-settings.json
```

Send this file to Steam Deck with KDE Connect. It normally lands in:

```text
/home/deck/Downloads/last-epoch-companion-settings.json
```

Then open Decky -> Last Epoch Companion and press:

```text
Load Setup File
Test Server
Scan Local Files
Send Snapshot
```

For production, use device pairing instead:

```text
Decky -> Last Epoch Companion -> Start Pairing
Web UI -> approve the shown code
Decky -> Check Pairing
Decky -> Send Snapshot
```

The plugin UI is intentionally button-first so it works with the Steam Deck controls and does not require the on-screen keyboard.

## Deploy

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Steam Deck Updates

Install or update the Decky plugin once from GitHub:

```bash
curl -L https://raw.githubusercontent.com/FollenPP/lastEpoch/master/scripts/install-on-steam-deck.sh -o /tmp/install-last-epoch-companion.sh
chmod +x /tmp/install-last-epoch-companion.sh
/tmp/install-last-epoch-companion.sh https://github.com/FollenPP/lastEpoch/releases/latest/download/last-epoch-companion.zip
```

After `v0.1.3`, the plugin has an `Updates` section:

```text
Check Updates
Install Latest
```

After installing an update from Decky, restart Decky or reboot Steam Deck.

Recommended public endpoint without a domain:

```text
http://185.201.28.103
```

If you later buy or attach a domain, create DNS:

```text
your-domain.example -> 185.201.28.103
```

## Steam Deck Paths

Default Full Offline paths:

```text
/home/deck/.config/unity3d/Eleventh Hour Games/Last Epoch/Saves
/home/deck/.config/unity3d/Eleventh Hour Games/Last Epoch/Filters
```

The Decky plugin reads these paths and sends a snapshot to the laptop. It does not edit save files.

## Snapshot API

`POST /api/snapshots`

The future-facing v1 companion endpoint is also available and accepts the same payload:

```text
POST /api/v1/companion/snapshots
POST /api/v1/imports/decky-snapshot
```

The installed Decky plugin can keep using `/api/snapshots`; both routes feed the same snapshot storage and analyzer.

## Build Analyzer API

The first implementation slice of the larger technical spec is exposed under `/api/v1`.

```text
GET  /api/v1/snapshots/{snapshotId}
POST /api/v1/snapshots/{snapshotId}/analyses
GET  /api/v1/analyses/{snapshotId}
POST /api/v1/analyses/{snapshotId}/recalculate
GET  /api/v1/analyses/{snapshotId}/issues
GET  /api/v1/analyses/{snapshotId}/metrics
GET  /api/v1/analyses/{snapshotId}/recommendations
GET  /api/v1/analyses/{snapshotId}/breakdown
GET  /api/v1/stashes/{snapshotId}/items
POST /api/v1/stashes/{snapshotId}/search-upgrades
POST /api/v1/stashes/{snapshotId}/items/{itemId}/simulate
POST /api/v1/loot-filters/generate
```

These endpoints currently provide a normalized build model, heuristic metrics, issues, recommendations, a development plan, and low-confidence stash upgrade candidates. Full item decoding, game-data formulas, passive node names, skill-tree simulation, and exact DPS/EHP calculations are intentionally separate next modules.

Headers:

```text
Content-Type: application/json
X-Pairing-Token: <token printed by server>
```

Body:

```json
{
  "deckName": "steamdeck",
  "createdAt": "2026-07-10T19:00:00.000Z",
  "files": [
    {
      "kind": "save",
      "relativePath": "STASH_CYCLE_0",
      "mtimeMs": 1783710000000,
      "contentBase64": "..."
    }
  ]
}
```

## Development Notes

The current analyzer is a safe first pass:

- classifies character, stash, and filter files;
- records hashes and file stats;
- extracts JSON-like structure when possible;
- extracts text signals from readable files;
- generates a conservative review loot filter that never hides items.

Once real save samples are available, the parser can be calibrated to decode item records and score upgrades.
