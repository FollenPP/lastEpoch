from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import shutil


ROOT = Path(__file__).resolve().parents[1]
RELEASE_ROOT = ROOT / "server" / "static" / "downloads"
PACKAGE_ROOT = RELEASE_ROOT / "last-epoch-companion"
ZIP_PATH = RELEASE_ROOT / "last-epoch-companion.zip"


def copy_file(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def main() -> None:
    if PACKAGE_ROOT.exists():
        shutil.rmtree(PACKAGE_ROOT)
    PACKAGE_ROOT.mkdir(parents=True)

    copy_file(ROOT / "decky-plugin" / "dist" / "index.js", PACKAGE_ROOT / "dist" / "index.js")
    copy_file(ROOT / "decky-plugin" / "main.py", PACKAGE_ROOT / "main.py")
    copy_file(ROOT / "decky-plugin" / "plugin.json", PACKAGE_ROOT / "plugin.json")
    copy_file(ROOT / "decky-plugin" / "package.json", PACKAGE_ROOT / "package.json")
    copy_file(ROOT / "decky-plugin" / "default-settings.json", PACKAGE_ROOT / "default-settings.json")
    copy_file(ROOT / "decky-plugin" / "README.md", PACKAGE_ROOT / "README.md")
    copy_file(ROOT / "decky-plugin" / "LICENSE", PACKAGE_ROOT / "LICENSE")
    copy_file(ROOT / "scripts" / "install-on-steam-deck.sh", RELEASE_ROOT / "install-on-steam-deck.sh")

    if ZIP_PATH.exists():
        ZIP_PATH.unlink()

    with ZipFile(ZIP_PATH, "w", ZIP_DEFLATED) as archive:
        for file_path in sorted(PACKAGE_ROOT.rglob("*")):
            if file_path.is_file():
                archive.write(file_path, file_path.relative_to(RELEASE_ROOT).as_posix())

    print(ZIP_PATH)
    with ZipFile(ZIP_PATH) as archive:
        for name in archive.namelist():
            print(name)


if __name__ == "__main__":
    main()
