# Deployment

Recommended production layout:

```text
Steam Deck Decky plugin
        |
        | HTTPS
        v
https://le.adlethome.ru
        |
        v
Node server on VPS
```

The Steam Deck no longer needs to be in the same Wi-Fi network as the laptop. The laptop, phone, and Deck all use the same public server.

## DNS

Create an `A` record:

```text
le.adlethome.ru -> 185.201.28.103
```

Using a subdomain is cleaner than putting the app on the root domain.

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
sudo cp deploy/nginx/le.adlethome.ru.conf /etc/nginx/sites-available/le.adlethome.ru
sudo ln -s /etc/nginx/sites-available/le.adlethome.ru /etc/nginx/sites-enabled/le.adlethome.ru
sudo nginx -t
sudo systemctl reload nginx
```

Then enable HTTPS:

```bash
sudo certbot --nginx -d le.adlethome.ru
```

## Pairing

1. Open `https://le.adlethome.ru` on the laptop.
2. Enter the admin token from `.env` into `Access token` and press `Save Token`.
3. On Steam Deck, open Decky -> Last Epoch Companion.
4. Press `Start Pairing`.
5. Approve the Deck code in the web UI.
6. Press `Check Pairing` on Deck.
7. Press `Send Snapshot`.

After pairing, the Deck stores a device token and no longer needs keyboard input.

On a public server, `/downloads/last-epoch-companion-settings.json` does not expose the admin token. Use pairing instead of setup-file import.
