# Plan

Release 1 is the overlay desktop app. The architecture was approved by Peter on 2026-10-30 with all six recommendations accepted (see docs/adr/0001).

## Milestones

| # | Milestone | Status |
|---|---|---|
| M0 | Foundation and spikes | In progress |
| M1 | Data core | Done (Peter accepted the M1 build) |
| M2 | Core five overlays, theme, settings, display fallbacks | Built on `claude/m2-integration`, awaiting Peter's acceptance (`docs/m2-acceptance.md`) |
| M3 | Layouts, auto-switching, multi-monitor | Not started |
| M4 | Remaining 26 overlays | Not started |
| M5 | Extras (audio, hotkeys, OBS, engineer, MQTT, SimHub, Twitch, league builder, race history, auto-fuel) | Not started |
| M6 | Hardening, auto-update, polish | Not started |

## M0 tickets

Tracked as GitHub issues under the M0 milestone.

1. Monorepo scaffold and CI
2. Electron shell and overlay-window spike, with a Windows installer artifact
3. Research: global keyboard hook and wheel/button-box input on Windows
4. Research: Garage 61 API (token, lap traces, terms, rate limits)
5. Research: LMU data access (LMU_Data shared memory layout, REST endpoints incl. pit menu writes)
6. Fixture capture tool for iRacing and LMU (after 1 and 5)

## M2 tickets

All branches merge into `claude/m2-integration`; nothing reaches `main` before Peter accepts the M2 build (`docs/m2-acceptance.md`).

| Ticket | Scope | Status |
|---|---|---|
| M2-0a, 0b, 0c | Contracts split in three parts: package scaffolding and registry, shared types and stubs, desktop shell and IPC stubs | Merged |
| M2-1 | Overlay settings schema and store | Merged |
| M2-2 | Overlay host: windows, layout, scale | Merged |
| M2-3 | UI table and formatters | Merged |
| M2-4 | Theme core | Merged |
| M2-5 | Settings shell, General and Performance pages | Merged |
| M2-6 | Display fallbacks, Developer page, tray | Merged |
| M2-7 | Field data from the iRacing and LMU adapters | Merged |
| M2-8 | Standings, pit stops, stints | Merged |
| M2-9 | Proximity for the Spotter | Merged |
| M2-10 | Fuel outputs | Merged |
| M2-11 | Overlays page | Merged |
| M2-12 | Appearance page | Merged |
| M2-13 | Driver table kit and fields | Merged |
| M2-14 | Spotter overlay | Merged |
| M2-15 | Pit Speed overlay | Merged |
| M2-16 | Fuel Calculator overlay | Merged |
| M2-17 | Relative overlay | Merged |
| M2-18 | Leaderboard overlay | Merged |
| M2-19 | Theme editor and sharing | Merged |
| M2-20 | Keep fuel data across sessions | Merged |
| M2-21 | Performance measurement (Developer page "Measure CPU") | In progress, built in parallel |
| M2-22 | Visual snapshot tests | Deferred to M6 |
| M2-23 | Acceptance checklist and docs | This branch |

Review fixes for waves A and B are merged into the integration branch.

## Working rules

- One ticket, one git worktree, one branch, one PR. Branches are named `claude/<ticket-slug>`.
- Peter approves a milestone's PRs together once its build passes his acceptance checklist. Nothing merges before that.
- Risky PRs (CI, native code, storage format, >300 lines, anything that went red) get an independent Opus review.
