# BeatBattleX
[![Discord](https://badgen.net/badge/icon/discord?icon=discord&label=Join%20the%20Discord)](https://discord.gg/XrtrRWauDw)

A extention to improve beat-battle.net

<img width="448" height="819" alt="image" src="https://github.com/user-attachments/assets/fd95214c-0a03-43e3-b742-379d717ca699" />
<img width="368" height="697" alt="image" src="https://github.com/user-attachments/assets/265b9242-28df-4e04-8ccd-7f905e104d34" />
<img width="758" height="250" alt="image" src="https://github.com/user-attachments/assets/fed7de1f-4f1e-44d4-a7f1-82b37ffbd266" />

---

## Features
- **Anonymous Reveal**: Reveal anonymous users, and anonymous "Entry 1" uploads.
- **Uploads**: filename, MIME type, size, duration, downloadable vs stream-only, playback link,
  average rating, and a `dupe (same sha256)` warning when two players submit the same file with alt detection.
- **Members**: ready state, Discord ID (read from the avatar URL) or Google-auth marker, how many
  kick votes each player has started, forfeits.
- **Joined / left members** and **kick history**, persisted per room in `localStorage`, so they
  survive a reload.
- **Chat**: mirrored log with avatars, plus `copy chat log`.
- **Known users**: a cross-room directory of everyone you've seen, with CSV import/export.

## Install
### 1. Install a userscript manager
Pick one for your browser:

**[Violentmonkey](https://violentmonkey.github.io/)**: Chrome, Edge, Firefox (recommended)

**[Tampermonkey](https://www.tampermonkey.net/)**: Chrome, Edge, Firefox, Safari, Opera


> **Chrome / Edge users:** Manifest V3 requires you to enable developer mode for userscript managers to work.
> Go to `chrome://extensions`, toggle **Developer mode** on (top right), then reload the browser.

### 2(b). Install the scripts
Click a link below with the manager installed, it opens the install prompt directly:

[`Click Here`](https://raw.githubusercontent.com/FaithfullyOSS/BeatBattleX/main/beatbattle-overlay.user.js)

Hit **Install** on the prompt, then open [beat-battle.net](https://beat-battle.net) and join a room.

### 2(b). Manual install (if the links don't trigger a prompt)</summary>
1. Open the raw file and copy everything.
2. In Tampermonkey/Violentmonkey, open the dashboard -> **+** (new script).
3. Select all, paste over it, save with `Ctrl+S`.

### 3. Auto-update
Both scripts carry `@updateURL` / `@downloadURL` pointing at this repo, so your manager checks for
new versions on its own schedule. To force a check now: Tampermonkey dashboard -> **Utilities** ->
**Check for userscript updates**.

### Keyboard shortcuts

| Keys | Action |
|---|---|
| `Alt` + `B` | Toggle the details panel |
| `Alt` + `H` | Show / hide the score HUD |
| `Alt` + `C` | Collapse / expand the score HUD |

Shortcuts are ignored while you're typing in a text field.

