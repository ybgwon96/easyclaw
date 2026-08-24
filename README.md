<p align="center">
  <img src="resources/icon.png" width="120" alt="EasyClaw Logo">
</p>

<h1 align="center">EasyClaw</h1>

<p align="center">
  <strong>One-click installer for OpenClaw AI agent</strong>
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.ko.md">한국어</a> · <a href="README.ja.md">日本語</a> · <a href="README.zh.md">中文</a> · <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="https://github.com/ybgwon96/easyclaw/releases/latest"><img src="https://img.shields.io/github/v/release/ybgwon96/easyclaw?color=f97316&style=flat-square" alt="Release"></a>
  <a href="https://github.com/ybgwon96/easyclaw/releases"><img src="https://img.shields.io/github/downloads/ybgwon96/easyclaw/total?color=34d399&style=flat-square" alt="Downloads"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue?style=flat-square" alt="Platform">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-8b5cf6?style=flat-square" alt="License"></a>
</p>

<p align="center">
  <a href="https://easyclaw.kr">Website</a> · <a href="https://github.com/ybgwon96/easyclaw/releases/latest">Download</a> · <a href="https://github.com/openclaw/openclaw">OpenClaw</a>
</p>

---

<p align="center">
  <img src="docs/demo.gif" width="600" alt="EasyClaw Demo">
</p>

## What is EasyClaw?

EasyClaw is a desktop installer that sets up [OpenClaw](https://github.com/openclaw/openclaw) AI agent **without any terminal commands**.

**Download → Run → Enter API key** — that's it. Three steps.

## Features

- **One-Click Install** — Automatically detects and installs WSL, Node.js, and OpenClaw
- **Multiple AI Providers** — Supports Anthropic, Google Gemini, OpenAI, MiniMax, and GLM
- **Telegram Integration** — Use your AI agent anywhere through a Telegram bot
- **Cross-Platform** — macOS (Intel + Apple Silicon) and Windows

## Download

| OS      | File   | Link                                                                                          |
| ------- | ------ | --------------------------------------------------------------------------------------------- |
| macOS   | `.dmg` | [Download](https://github.com/ybgwon96/easyclaw/releases/latest/download/easy-claw.dmg)       |
| Windows | `.exe` | [Download](https://github.com/ybgwon96/easyclaw/releases/latest/download/easy-claw-setup.exe) |

You can also download from [easyclaw.kr](https://easyclaw.kr) — it auto-detects your OS.

## Windows Security Notice

We're in the process of obtaining a Windows code signing certificate. You may see a security warning during installation.

> - [VirusTotal scan result](https://www.virustotal.com/gui/url/800de679ba1d63c29023776989a531d27c4510666a320ae3b440c7785b2ab149) — 0 detections across 94 antivirus engines
> - Fully open source — anyone can inspect the code
> - Built with GitHub Actions CI/CD — transparent build process

<details>
<summary><b>If you see "Windows protected your PC"</b></summary>

1. Click **"More info"**
2. Click **"Run anyway"**

</details>

## Pro Setup Service 🛠️

Stuck during installation, or want everything set up for you? The creator of EasyClaw offers a **paid remote setup session** — installation, API key configuration, Telegram bot connection, and a quick usage walkthrough. About 40 minutes, ₩50,000 (~$40). Korean or English.

📧 [hello@needslab.ai](mailto:hello@needslab.ai) — subject: "EasyClaw Setup"

## Support EasyClaw ☕

EasyClaw is free and open source, built and maintained by one person. If it saved you a trip through the terminal, consider buying the developer a coffee — it keeps the updates coming.

**[☕ 후원하기 / Buy me a coffee](https://qr.kakaopay.com/281006011000066615032016)**

## Tech Stack

| Area      | Technology                                               |
| --------- | -------------------------------------------------------- |
| Framework | Electron + electron-vite                                 |
| Frontend  | React 19 + Tailwind CSS 4                                |
| Language  | TypeScript                                               |
| Build/CI  | electron-builder + GitHub Actions                        |
| Code Sign | Apple Notarization (macOS) / SignPath (Windows, pending) |

## Development

```bash
npm install    # Install dependencies
npm run dev    # Development mode (electron-vite dev)
npm run build  # Type check + build
npm run lint   # ESLint
npm run format # Prettier
```

Platform-specific packaging:

```bash
npm run build:mac-local  # macOS local build
npm run build:win-local  # Windows local build
```

> **Note**: macOS code signing requires `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_LINK`, `CSC_KEY_PASSWORD` environment variables. Without them, the app will be built unsigned.

## Project Structure

```
src/
├── main/             # Main process (Node.js)
│   ├── services/     # Env check, installer, onboarding, gateway
│   └── ipc-handlers  # IPC channel router
├── preload/          # contextBridge (IPC API bridge)
└── renderer/         # React UI (7-step wizard)
api/                  # Vercel serverless functions
docs/                 # Landing page (easyclaw.kr)
```

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before getting started.

## Credits

Built on [OpenClaw](https://github.com/openclaw/openclaw) (MIT License) by the [openclaw](https://github.com/openclaw) team.

## License

[MIT](LICENSE)
