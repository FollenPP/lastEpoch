# GitHub Publishing

## Repository

Create an empty GitHub repository, for example:

```text
https://github.com/YOUR_USER/last-epoch-companion
```

Then from this local checkout:

```bash
git remote add origin https://github.com/YOUR_USER/last-epoch-companion.git
git push -u origin master
```

## Release

Create a version tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions will build:

```text
server/static/downloads/last-epoch-companion.zip
```

and attach it to the release.

## Steam Deck Install From GitHub

After the first release exists:

```bash
curl -L https://raw.githubusercontent.com/YOUR_USER/last-epoch-companion/master/scripts/install-on-steam-deck.sh -o /tmp/install-last-epoch-companion.sh
chmod +x /tmp/install-last-epoch-companion.sh
/tmp/install-last-epoch-companion.sh https://github.com/YOUR_USER/last-epoch-companion/releases/latest/download/last-epoch-companion.zip
```

The same command updates the plugin later.

Starting with `v0.1.3`, the Decky plugin also includes:

```text
Updates -> Check Updates -> Install Latest
```

That flow downloads the latest GitHub release asset and replaces the plugin files in place. A Decky restart or Steam Deck reboot is still required after installing.
