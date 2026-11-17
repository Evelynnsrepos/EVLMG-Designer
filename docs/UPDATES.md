# Updates

How the desktop app updates itself, and the one-time setup only the repo owner can do.

## How it works

- About 10 s after start (and once a day while it stays open) the app downloads
  `releases/latest/download/latest.json` from GitHub (`src-tauri/src/updates.rs`, `update_check`).
- If that version is newer, the start screen shows a card (`src/shell/updates/`). Nothing installs without a click.
- **Windows (NSIS), macOS, AppImage:** Update downloads the file, checks its signature against the public key in
  `tauri.conf.json` (`plugins.updater.pubkey`) and installs it. Restart now restarts the app.
- **Flatpak:** the card only says a new version is out. Flatpak installs it from our own repo on GitHub Pages
  (`Evelynnsrepos/egd-flatpak`), which the `.flatpak` from the release page adds when it is installed.
- **.deb and source builds:** the card only says a new version is out, with a link to the release page.
- Settings > General > Updates: switch, Check now, Skip this version undo.
- The phone app has no update commands; the card and the Settings section hide themselves there.
- `EGD_UPDATE_URL=<url of a latest.json>` makes the app read another update file (for testing).

`release.yml` signs the installers and writes `latest.json` only when the `TAURI_SIGNING_PRIVATE_KEY` secret exists;
without it releases build exactly as before. `flatpak.yml` fills the Flatpak repo only when
`FLATPAK_GPG_PRIVATE_KEY` and `FLATPAK_REPO_TOKEN` exist.

Important: once installs can update, replacing files under the same version number no longer reaches people.
Small fixes need a new patch number (0.35.1).

## One-time setup (Evelynn)

### 1. Updater key

In the app folder (`~/Claude/EvelynnGDer/app`):

```bash
nix-shell --run "npx tauri signer generate -w ~/egd-updater.key"
```

It asks for a password. Then:

1. Open `~/egd-updater.key.pub` and put its one line into `src-tauri/tauri.conf.json` instead of
   `PASTE_THE_PUBLIC_UPDATER_KEY_HERE` (or paste it in the chat: the public key is safe to share).
2. On https://github.com/Evelynnsrepos/EVLMG-Designer/settings/secrets/actions add two secrets:
   `TAURI_SIGNING_PRIVATE_KEY` = the whole content of `~/egd-updater.key`,
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = the password.
3. Back up `~/egd-updater.key` and the password (password manager or USB stick). If it is lost, installed apps
   can never update again and everyone has to download by hand once.

### 2. Flatpak repo

1. Make a new **public**, empty repo `Evelynnsrepos/egd-flatpak` on GitHub.
2. Make a signing key without a password (the release run must use it unattended):
   ```bash
   gpg --batch --passphrase '' --quick-gen-key "EVLMG Designer Flatpak" ed25519 sign never
   gpg --armor --export-secret-keys "EVLMG Designer Flatpak" > ~/egd-flatpak-key.asc
   ```
3. Add the secret `FLATPAK_GPG_PRIVATE_KEY` = the content of `~/egd-flatpak-key.asc`, and back the file up.
4. Make a fine-grained token (https://github.com/settings/personal-access-tokens/new): only the repo
   `egd-flatpak`, permission Contents: Read and write. Add it as the secret `FLATPAK_REPO_TOKEN`.
5. After the first release run: in `egd-flatpak` go to Settings > Pages and pick "Deploy from a branch", `gh-pages`, `/ (root)`.

People on an older `.flatpak` install the new one once, or run:
`flatpak remote-add --if-not-exists egd https://evelynnsrepos.github.io/egd-flatpak/egd.flatpakrepo`

### 3. Try the card before a release

Save this as `~/egd-test/latest.json`:

```json
{ "version": "9.9.9", "notes": "Test update: this is only the card.", "platforms": {} }
```

Then run `cd ~/egd-test && python3 -m http.server 8765` in one terminal and, in the app folder,
`EGD_UPDATE_URL=http://localhost:8765/latest.json scripts/try.sh feat/updater` in another.
The start screen shows the card after about 10 seconds. A run from source counts as a ".deb/source" install,
so it shows the release page button, not Update. The first real install test is the release after the one that
brings the updater.
