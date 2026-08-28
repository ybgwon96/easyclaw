# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.34] - 2025-03-15

### Fixed
- Treat WSL exit -1 as immediate reboot signal

## [1.3.33] - 2025-03-14

### Fixed
- Handle WSL install exit code -1 by verifying actual state

## [1.3.32] - 2025-03-13

### Fixed
- Create parent directory before writing auth-profiles.json on WSL

## [1.3.31] - 2025-03-12

### Refactored
- Simplify OAuth callback and deduplicate onboarder constants

## [1.3.30] - 2025-03-11

### Fixed
- Register OAuth auth profile in openclaw.json config

## [1.3.29] - 2025-03-10

### Fixed
- OAuth direct PKCE flow, mascot restore, auth window title bar

## [1.3.28] - 2025-03-09

### Fixed
- OAuth login debugging + i18n key mismatch

## [1.3.27] - 2025-03-08

### Documentation
- Add OpenAI OAuth design and implementation plan

### Features
- Add OpenAI OAuth (Codex) authentication support

## [1.3.26] - 2025-03-07

### Features
- GitHub Star button added
- Landing page hero layout improvement

### Internationalization
- Add multi-language (i18n) support (ko/en/ja/zh)

## [1.3.25] - 2025-03-06

### Fixed
- WSL installation error message improvement and reboot loop fix

### Fixed
- Change landing page version badge API URL to current repository

## [1.3.24] - 2025-03-05

### Fixed
- Use openclaw binary directly instead of npm exec

## [1.3.23] - 2025-03-04

### Documentation
- Update README AI provider list

### Fixed
- Place GitHub/Open chat buttons on same line in landing page

## [1.3.22] - 2025-03-03

### Features
- Add GitHub repository button to landing page

## [1.3.21] - 2025-03-02

### Features
- Add Product Hunt badge (light theme)

## [1.3.20] - 2025-03-01

### Features
- Add Product Hunt badge to landing page
- Add demo GIF and reflect in README

## [1.3.19] - 2025-02-28

### Features
- Global marketing: README internationalization, open source files, marketing content

## [1.3.18] - 2025-02-27

### Refactored
- Translate Korean code comments to English for international contributors

## [1.3.17] - 2025-02-26

### Features
- EasyCode landing page integration (Easy brand portal)

### Fixed
- Preserve cross-banner SVG and strengthen vercel rewrite

### Refactored
- Code review feedback: deduplication, caching, XSS reinforcement

## [1.3.16] - 2025-02-25

### Features
- Landing page global SEO optimization and demo GIF addition

## [1.3.15] - 2025-02-24

### Features
- Demo GIF addition

## [1.3.14] - 2025-02-23

### Documentation
- Create CLAUDE.md with project guidance

## [1.3.13] - 2025-02-22

### Features
- Add OpenClaw 1.0.0 changelog and release note

## [1.3.12] - 2025-02-21

### Features
- Add OpenClaw 1.0.0 landing page

## [1.3.11] - 2025-02-20

### Features
- Add macOS arm64 binary download support
- Add auto-update functionality

### Fixed
- Fix Windows installation path handling

## [1.3.10] - 2025-02-19

### Features
- Add OpenClaw installer for Windows, macOS, Linux

## [1.3.9] - 2025-02-18

### Features
- Add code execution security settings in CLAUDE.md
- Add project overview and core features in README

## [1.3.8] - 2025-02-17

### Documentation
- Add comprehensive CLAUDE.md with development guidelines

## [1.3.7] - 2025-02-16

### Features
- Add Feishu integration: bitable, doc, wiki, drive operations

## [1.3.6] - 2025-02-15

### Features
- Add OpenClaw 1.0.0 preview features

## [1.3.5] - 2025-02-14

### Features
- Add Claude Code integration

## [1.0.1] - 2024-01-01

### Initial Release
- Initial release of EasyClaw - One-click installer for OpenClaw AI agent