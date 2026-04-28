# QA Checklist — v1.3.39 Gateway Stability

This release addresses the recurring "Gateway keeps shutting down" issue
reported by multiple users in the Kakao group chat. Run every scenario
on both macOS and Windows (WSL) before tagging the release.

## Setup
- [ ] Build a fresh installer from `feat/gateway-supervisor` + `feat/gateway-diagnostic`
- [ ] Install over a v1.3.38 install (upgrade path) on both OSes
- [ ] Verify `~/Library/Application Support/easy-claw/logs/` exists after first
      launch (macOS) or `%APPDATA%/easy-claw/logs/` (Windows)

## S1 — Force-kill triggers auto-restart
- [ ] **macOS**: `pkill -9 -f openclaw-gateway`
  - Tray flips to "Gateway Restarting..." within ~5s
  - Within ~10s, tray returns to "Gateway Running"
  - `logs/gateway-YYYY-MM-DD.log` shows the death + restart attempt
  - Notification "Gateway just exited — auto-restarting now" appears
- [ ] **Windows WSL**: `wsl -d Ubuntu -u root -- pkill -9 -f openclaw`
  - Same expectations as above
  - **Regression check**: previously the tray stayed at "running" because
    `wsl.exe`'s `.killed` flag was false. Confirm new probe correctly
    detects the inner process death.

## S2 — Crash loop hits give-up + diagnostic modal
- [ ] Repeatedly kill the gateway 5 times within 60 s using the S1 commands
- [ ] After the 5th attempt:
  - Tray label changes to "Gateway Failed (max restarts reached)"
  - DoneStep shows the red "Gateway 재시작 실패" banner
  - DiagnosticModal opens automatically
  - Notification "Gateway failed to restart 5 times" fires (bypasses throttle)
- [ ] Click "Copy to Clipboard" — diagnostic text is on the clipboard
- [ ] Click "Open Kakao Group Chat" — opens https://open.kakao.com/o/gbBkPehi
- [ ] Click "Retry" — gateway starts again, banner clears
- [ ] Wait 60 minutes, kill again — auto-restart resumes (window slid)

## S3 — onboard finishes with gateway already alive
- [ ] Wipe install (`uninstall:openclaw` + remove `~/.openclaw/`)
- [ ] Run through onboarding from scratch with a Telegram bot
- [ ] When DoneStep appears, `electronAPI.gateway.status()` returns
      `running` immediately (no 30 s polling delay)
- [ ] `userData/logs/launchd-gateway.{out,err}.log` (macOS) starts
      receiving daemon output

## S4 — switchProvider boots the daemon exactly once
- [ ] In DoneStep, click "변경" → switch from current provider to another
- [ ] Inspect `gateway-restart-history.json` and the daemon log
- [ ] Exactly **one** `kind=manual success=true` entry appears (was 2 in v1.3.38)

## S5 — App quit cleans up
- [ ] macOS: tray menu → Quit
  - `pgrep -f openclaw-gateway` returns empty (or launchd-managed PID is gone)
  - Log file ends with `[meta] app quit — cleanup done`
- [ ] Windows: tray menu → Quit
  - `wsl --list --running` does not show openclaw running

## S6 — Log rotation
- [ ] Generate a few days of logs (or fast-forward the system clock by 8 days)
- [ ] Re-launch EasyClaw — files older than 7 days deleted from `logs/`
- [ ] Create a 60 MB fake log to exceed cap — oldest files trimmed first

## S7 — PII masking
- [ ] Trigger a crash with a placeholder bot token in the daemon stderr
      (set `TELEGRAM_BOT_TOKEN=bot<DIGITS>:<35+_TOKEN_CHARS>` shaped to match
      the regex `bot([0-9]+):[A-Za-z0-9_-]{30,}`)
- [ ] Open DiagnosticModal — the digits part is preserved while the token
      part is shown as `****MASKED****`
- [ ] Same check for `sk-...`, `sk-ant-...`, `AIza...` patterns (use any
      string matching the shape; do not paste a real key)

## Sign-off
- [ ] macOS results captured in screenshots / paste of diagnostic text
- [ ] Windows results captured the same way
- [ ] CHANGELOG entry drafted
- [ ] Ready to `npm run release` (patch bump from 1.3.38 → 1.3.39)
