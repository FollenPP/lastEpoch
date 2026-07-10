# Last Epoch Companion Decky Plugin

This plugin sends a read-only snapshot of Last Epoch Full Offline files to the laptop server.

Production default server:

```text
https://le.adlethome.ru
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

## Safety

- Save files are read only.
- Files larger than 25 MB are skipped.
- The plugin writes only its settings and optional generated loot filters.
- No root flag is requested.

## Setup Without Typing

Preferred production flow:

```text
Start Pairing -> approve code in web UI -> Check Pairing -> Send Snapshot
```

Local development fallback: send this file from the laptop to Steam Deck:

```text
server/static/downloads/last-epoch-companion-settings.json
```

Then press `Load Setup File` in the plugin. The plugin reads:

```text
/home/deck/Downloads/last-epoch-companion-settings.json
```
