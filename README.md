# Antigravity Studio 2.0 — Aether Metallic Violet & Biometric MFA Edition

Custom high-craft **Metallic Violet / Amethyst Chrome** UI engine, Studio Cinematic Sci-Fi audio suite, and **4-Method Multi-Factor Biometric Security Vault** for **Antigravity 2.0** — engineered for **`Binh Phan` (`BINHPHAN-SOFTWARE-ENGINEER`)** without modifying `app.asar`.

---

## Key Highlights

- **Aether Metallic Violet Design System:**
  - Custom 3D obsidian-amethyst metallic ribbon backdrop (`aether_metallic_violet.webp`), bespoke metallic filigree SVGs, pre-baked 120fps frosted glass (`syncPrebakedGlass`), and offline `Plus Jakarta Sans` + `JetBrains Mono` typography.
- **4-Method Multi-Factor Identity Verification Hub (Boot Gate):**
  1. **AI Face ID (Primary Default):** 100% offline OpenCV Zoo **YuNet** (5-landmark detection) + **SFace INT8** (128-D embedding) running on ONNX Runtime CPU with 3-frame liveness streak & rolling 8-frame anti-static-replay protection. Automatically falls back to **6-Digit Passcode** if the camera is off, covered, or dark.
  2. **6-Digit Stealth Passcode:** Keyboard & tactile keypad entry backed by server-side `crypto.scrypt` hashing.
  3. **Windows Hello Hardware Security:** Native Windows `UserConsentVerifier` integration (Fingerprint, IR Face, or Windows PIN).
  4. **Engineer Terminal & 3-Step Secret Key Chord:** Masked passphrase verification + configurable 3-combo secret key sequence.
- **Hardened Local Security Architecture:**
  - Zero client-side credential hashes; secrets are stored exclusively in `auth_vault.json` (`0600`) using `scrypt` (`N=16384, r=8, p=1`) + random 128-bit salts + `crypto.timingSafeEqual`.
  - Ephemeral 256-bit per-session `X-Agy-Token` authentication, strict `127.0.0.1` Origin enforcement, single-use `unlockProof`, time-scoped `adminTicket` for settings rotation, exponential brute-force lockout (`429`), and `MutationObserver` + `inert` DOM workspace isolation.
- **Studio Cinematic Sci-Fi Audio:**
  - Studio-grade sci-fi boot sound design (`cyber_voice1.mp3` – `cyber_voice4.mp3`) and task-completion glass chime (`Studio_Glass_Chime.mp3`).

---

## Requirements

- **Node.js >= 22** (uses built-in `WebSocket`, zero `npm install` needed).
- **Python >= 3.10** with `Pillow`, `numpy`, and `onnxruntime` (`pip install pillow numpy onnxruntime`).

---

## Quick Start (Windows)

```powershell
git clone https://github.com/binhphanbp/antigravity-custom-theme-mod.git
cd antigravity-custom-theme-mod

# 1. Build dist/theme_payload.js
python scripts/build_payload.py

# 2. Configure permanent Windows Startup & Antigravity CDP shortcut (--remote-debugging-port=0)
powershell -ExecutionPolicy Bypass -File ".\scripts\setup-permanent.ps1"

# 3. Restart / launch background daemon anytime
powershell -ExecutionPolicy Bypass -File ".\scripts\install-win.ps1"
```

Verify active CDP injection:

```powershell
node .\scripts\verify_cdp.js
```

---

## Security Vault Configuration

On first launch, `daemon/theme_daemon.js` initializes a local `auth_vault.json` (git-ignored). Open **Sidebar → `Custom theme` → `Multi-Factor Security Vault`**, enter your current PIN in **Authorize Changes**, and customize:
- **6-Digit Passcode**
- **Engineer Terminal Passphrase**
- **3-Step Secret Key Chord**
- **HD Face ID Calibration** (via `Calibrate HD Face ID` on the boot lock screen)

---

## Project Structure

```text
.
├── daemon/
│   ├── theme_daemon.js        # CDP injector, scrypt Security Vault & protected Media Server
│   ├── face_engine.py         # Offline YuNet + SFace INT8 biometric engine with anti-replay
│   └── models/                # Bundled yunet.onnx & sface_int8.onnx models
├── engine/
│   └── core.js                # Runtime UI engine, Boot MFA Hub, Tamper Guard & Theme Studio
├── scripts/
│   ├── build_payload.py       # Compiles themes.json + offline assets + core.js -> dist/
│   ├── setup-permanent.ps1    # Configures Windows Startup + Antigravity CDP shortcuts
│   ├── install-win.ps1        # Starts/restarts silent Windows background daemon
│   ├── install-unix.sh        # macOS / Linux daemon installer
│   ├── verify_cdp.js          # Verifies live CDP connection
│   └── uninstall.js           # Stops daemon and restores default UI
└── themes/
    ├── themes.json            # Theme presets (Aether Metallic Violet default)
    ├── assets/                # Wallpapers, custom SVGs, WOFF2 fonts, studio sci-fi audio
    └── user_media/            # Default Studio Glass Chime (private uploads git-ignored)
```

---

## License

Released under the [MIT License](LICENSE). Based on [antigravity-custom-theme-mod](https://github.com/furinamikuvn/antigravity-custom-theme-mod) / [antigravity-custom-theme-skill](https://github.com/giakiet22102006/antigravity-custom-theme-skill).
