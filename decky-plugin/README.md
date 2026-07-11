# Last Epoch Companion Decky Plugin

This plugin sends a read-only snapshot of Last Epoch Full Offline files to the companion server.

Production default server:

```text
http://185.201.28.103
```

Default Steam Deck paths:

```text
/home/deck/.config/unity3d/Eleventh Hour Games/Last Epoch/Saves
/home/deck/.config/unity3d/Eleventh Hour Games/Last Epoch/Filters
```

## Build

Decky plugin tooling expects `pnpm`.

```bash
pnpm install
pnpm run build
```

For local development, install the built plugin folder into Decky according to the Decky plugin development workflow.

## Updates

The plugin can check GitHub Releases and install the latest plugin zip from:

```text
https://github.com/FollenPP/lastEpoch/releases/latest/download/last-epoch-companion.zip
```

Use `Updates -> Check Updates -> Install Latest`, then restart Decky or reboot Steam Deck.

## Safety

- Save files are read only.
- Files larger than 25 MB are skipped.
- The plugin writes only its settings and optional generated loot filters.
- No root flag is requested.

## Setup

Preferred production flow:

```text
Start Pairing -> approve code in web UI -> Check Pairing -> Send Snapshot
```

The server URL is hardcoded in the plugin and is not read from setup or settings files.
