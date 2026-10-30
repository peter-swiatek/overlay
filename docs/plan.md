# Plan

Release 1 is the overlay desktop app. The architecture was approved by Peter on 2026-10-30 with all six recommendations accepted (see docs/adr/0001).

## Milestones

| # | Milestone | Status |
|---|---|---|
| M0 | Foundation and spikes | In progress |
| M1 | Data core | Not started |
| M2 | Core five overlays, theme, settings, display fallbacks | Not started |
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

## Working rules

- One ticket, one git worktree, one branch, one PR. Branches are named `claude/<ticket-slug>`.
- Peter approves a milestone's PRs together once its build passes his acceptance checklist. Nothing merges before that.
- Risky PRs (CI, native code, storage format, >300 lines, anything that went red) get an independent Opus review.
