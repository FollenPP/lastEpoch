# Deployment

Recommended production layout:

```text
Steam Deck Decky plugin
        |
        | HTTP by public IP
        v
http://185.201.28.103
        |
        v
Node server on VPS
```

The Steam Deck no longer needs to be in the same Wi-Fi network as the laptop. The laptop, phone, and Deck all use the same public server.

The Decky plugin is the Steam Deck companion for the larger Build Analyzer architecture. It can keep sending to `/api/snapshots`; the server also exposes `/api/v1/companion/snapshots` for future companion clients with the same payload contract.

## No-Domain Mode

This project can run without a domain:

```text
PUBLIC_BASE_URL=http://185.201.28.103
```

This is the easiest setup. The downside is that plain HTTP does not encrypt tokens or snapshots in transit. It is fine for first validation, but for long-term use prefer a domain with HTTPS, an IP certificate, or a private network such as Tailscale/WireGuard.

## VPS Install

On the VPS:

```bash
git clone https://github.com/YOUR_USER/last-epoch-companion.git
cd last-epoch-companion
cp .env.example .env
nano .env
docker compose up -d --build
```

Use a long random token:

```bash
openssl rand -base64 32
```

## Nginx

Copy:

```bash
sudo cp deploy/nginx/ip-only.conf /etc/nginx/sites-available/last-epoch-companion
sudo ln -sf /etc/nginx/sites-available/last-epoch-companion /etc/nginx/sites-enabled/last-epoch-companion
sudo nginx -t
sudo systemctl reload nginx
```

## HTTPS Later

The cleanest HTTPS path is still a domain or subdomain pointed at `185.201.28.103`. If you do not want a domain, you can keep HTTP for now and later switch to an IP-address certificate or a private VPN-style setup.

## Pairing

1. Open `http://185.201.28.103` on the laptop.
2. Enter the admin token from `.env` into `Access token` and press `Save Token`.
3. On Steam Deck, open Decky -> Last Epoch Companion.
4. Press `Start Pairing`.
5. Approve the Deck code in the web UI.
6. Press `Check Pairing` on Deck.
7. Press `Send Snapshot`.

After pairing, the Deck stores a device token and no longer needs keyboard input.

On a public server, `/downloads/last-epoch-companion-settings.json` does not expose the admin token. Use pairing instead of setup-file import.

## Updating

Update the VPS app:

```bash
cd ~/lastEpoch
git pull
docker compose up -d --build
```

Update the Steam Deck plugin:

```text
Decky -> Last Epoch Companion -> Updates -> Check Updates -> Install Latest
```

Then restart Decky or reboot Steam Deck.
