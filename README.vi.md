<p align="center">
  <img src="resources/icon.png" width="120" alt="EasyClaw Logo">
</p>

<h1 align="center">EasyClaw</h1>

<p align="center">
  <strong>Cài đặt OpenClaw AI agent chỉ với một cú nhấp chuột</strong>
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.ja.md">日本語</a> · <a href="README.zh.md">中文</a> · <a href="README.ko.md">한국어</a> · Tiếng Việt
</p>

<p align="center">
  <a href="https://github.com/ybgwon96/easyclaw/releases/latest"><img src="https://img.shields.io/github/v/release/ybgwon96/easyclaw?color=f97316&style=flat-square" alt="Release"></a>
  <a href="https://github.com/ybgwon96/easyclaw/releases"><img src="https://img.shields.io/github/downloads/ybgwon96/easyclaw/total?color=34d399&style=flat-square" alt="Downloads"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue?style=flat-square" alt="Platform">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-8b5cf6?style=flat-square" alt="License"></a>
</p>

<p align="center">
  <a href="https://easyclaw.kr">Trang chủ</a> · <a href="https://github.com/ybgwon96/easyclaw/releases/latest">Tải xuống</a> · <a href="https://open.kakao.com/o/gbBkPehi">Cộng đồng</a> · <a href="https://github.com/openclaw/openclaw">OpenClaw</a>
</p>

---

<p align="center">
  <img src="docs/screenshots/welcome.png" width="270" alt="Màn hình chào mừng">
  &nbsp;&nbsp;
  <img src="docs/screenshots/env-check.png" width="270" alt="Kiểm tra môi trường">
  &nbsp;&nbsp;
  <img src="docs/screenshots/done.png" width="270" alt="Cài đặt hoàn tất">
</p>

## Giới thiệu

[OpenClaw](https://github.com/openclaw/openclaw) AI agent với **không cần thao tác terminal phức tạp**.

**Tải xuống → Chạy → Nhập API key**, chỉ 3 bước.

## Tính năng chính

- **Cài đặt một cú nhấp** — Tự động phát hiện và cài đặt WSL, Node.js, OpenClaw
- **Nhiều nhà cung cấp AI** — Hỗ trợ Anthropic, Google Gemini, OpenAI, MiniMax, GLM
- **Tích hợp Telegram** — Sử dụng AI agent ở bất kỳ đâu qua Telegram bot
- **Đa nền tảng** — macOS (Intel + Apple Silicon) / Windows

## Tải xuống

| OS      | File   | Liên kết                                                                                          |
| ------- | ------ | ------------------------------------------------------------------------------------------------- |
| macOS   | `.dmg` | [Tải xuống](https://github.com/ybgwon96/easyclaw/releases/latest/download/easy-claw.dmg)       |
| Windows | `.exe` | [Tải xuống](https://github.com/ybgwon96/easyclaw/releases/latest/download/easy-claw-setup.exe) |

Bạn cũng có thể tải từ [easyclaw.kr](https://easyclaw.kr) — nó tự động phát hiện OS của bạn.

## Hướng dẫn cảnh báo bảo mật Windows

Chúng tôi đang trong quá trình xin chứng chỉ ký code Windows. Bạn có thể thấy cảnh báo bảo mật khi cài đặt.

> - [Kết quả quét VirusTotal](https://www.virustotal.com/gui/url/800de679ba1d63c29023776989a531d27c4510666a320ae3b440c7785b2ab149) — 0 phát hiện trên 94 engine diệt virus
> - Mã nguồn mở — ai cũng có thể kiểm tra code
> - GitHub Actions CI/CD — quy trình build minh bạch

<details>
<summary><b>Nếu thấy cảnh báo "Windows protected your PC"</b></summary>

1. Nhấn **"More info"**
2. Nhấn **"Run anyway"**

</details>

## Công nghệ

| Lĩnh vực       | Công nghệ                                                     |
| ---------- | -------------------------------------------------------- |
| Framework | Electron + electron-vite                                 |
| Frontend | React 19 + Tailwind CSS 4                                |
| Ngôn ngữ       | TypeScript                                               |
| Build/Deploy  | electron-builder + GitHub Actions                        |
| Ký code  | Apple Notarization (macOS) / SignPath (Windows, đang tiến hành) |

## Phát triển

```bash
npm install    # Cài đặt dependencies
npm run dev    # Chế độ dev (electron-vite dev)
npm run build  # Type check + build
npm run lint   # ESLint
npm run format # Prettier
```

Đóng gói theo nền tảng:

```bash
npm run build:mac-local  # Build macOS local
npm run build:win-local  # Build Windows local
```

> **Lưu ý**: Cần các biến môi trường `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_LINK`, `CSC_KEY_PASSWORD` để ký/notarize macOS. Nếu không có, sẽ build không có signature.

## Cấu trúc dự án

```
src/
├── main/             # Main process (Node.js)
│   ├── services/     # Kiểm tra môi trường, cài đặt, onboarding, gateway
│   └── ipc-handlers  # IPC channel router
├── preload/          # contextBridge (expose IPC API)
└── renderer/         # React UI (7-step wizard)
api/                  # Vercel serverless functions
docs/                 # Landing page (easyclaw.kr)
```

## Đóng góp

Rất hoan nghênh đóng góp! Xem [CONTRIBUTING.md](CONTRIBUTING.md).

## Credit

Dựa trên [OpenClaw](https://github.com/openclaw/openclaw) (MIT License) — phát triển bởi đội ngũ [openclaw](https://github.com/openclaw)

## Giấy phép

[MIT](LICENSE)
