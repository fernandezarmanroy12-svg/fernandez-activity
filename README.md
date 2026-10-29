# SwitchGuard — Dead Man's Switch for Scheduled Tasks

> Inspired by **[Healthchecks.io](https://healthchecks.io/)** — Built using **strictly HTML, CSS, and Vanilla JavaScript**.

## ⚡ What is a Dead Man's Switch?

Unlike traditional active monitors that probe your servers (increasing the attack surface and needing inbound firewall ports), a **Dead Man's Switch is completely passive**:

1. Your scheduled task (cron job, backup script, data sync worker, SSL renewal) runs on its regular schedule.
2. At the end of execution, your script sends a single HTTP ping to its unique URL:
   ```bash
   /path/to/backup.sh && curl -fsS -m 10 http://localhost/track/ping.html?uuid=7d4f9b2a-8c11-4a92-bf35-9e32a67bc01
   ```
3. If SwitchGuard does **not** receive a ping before the scheduled deadline plus grace period, it assumes the task stalled or failed, triggering an immediate alert.

---

## 🌟 Key Features

- **Zero Overhead & Zero Attack Surface**: Pure passive monitoring — no daemons or agent software needed on your target servers.
- **Dead Man's Switch State Engine**:
  - `UP` (Healthy) — glowing emerald radar pulse.
  - `GRACE` (Running Late) — cyber amber warning countdown.
  - `DOWN` (Tripped / Dead) — emergency crimson alarm.
  - `STARTED` (Job in Progress) — measures execution time.
  - `PAUSED` — maintenance mode.
- **20-Run Visual Timeline Ribbon**: Healthchecks.io signature block timeline showing recent ping history, latency, and status.
- **Interactive Time Machine**:
  - Warp time forward (`+5 min`, `+1 hour`, `+1 day`, or custom) to test how tasks transition into Grace and Down states without waiting hours in real life.
- **Multi-Language Integration Snippet Generator**:
  - Ready-to-copy code snippets for **cURL/Bash**, **Python**, **PowerShell**, **Node.js**, **Crontab**, and **Docker**.
- **Interactive Sandbox Testing**:
  - Test-fire success pings, job `/start` tracking, simulated failures (`/fail`), or trip the switch instantly.
- **Synthesized Audio Alarms**:
  - Built-in Web Audio API synthesizer for realistic success chimes, warning tones, and emergency alarms (zero external audio files).
- **Persistent LocalStorage & Live Telemetry Feed**:
  - Real-time audit log of incoming signals, duration, and error payloads.

---

## 🚀 Quick Start

1. Open your browser to:
   ```
   http://localhost/track/index.html
   ```
   *(Or double-click `index.html` to open directly in any browser)*

2. To test an external ping from command line or cron:
   ```bash
   curl "http://localhost/track/ping.html?uuid=7d4f9b2a-8c11-4a92-bf35-9e32a67bc01"
   ```
