# Handoff

Last updated 2026-10-31.

- Release 1 architecture approved; M0 starting.
- Repo was empty; `main` holds only README and docs until the M0 PRs merge.
- Open questions for Peter: none yet. The Garage 61 spike will need his personal access token.

## Telemetry core (M1-6a)

`apps/desktop/src/telemetry/` is the utility process that turns sim memory into `TelemetryFrame`s
(`packages/sim-core/src/telemetry`). Main-process wiring and the renderer client are M1-6b (below).

Needs a manual check on Windows (everything else runs on Linux CI with fakes and the committed slices):

- Capture coexistence: the capture and telemetry processes both open the iRacing and LMU mappings
  read-only, and both may wait on `IRSDKDataValidEvent`. If iRacing created it as an auto-reset
  event, one signal wakes only one waiter and the two processes could split signals. The telemetry
  source copes (it waits at most 20 ms, then reads the newest tickCount), but check with capture
  recording that neither the capture fps nor the telemetry rate drops.
- `telemetry-session-worker.js` is found next to `telemetry.js` in a packaged build.
- Live iRacing and LMU liveness: the auto-detect switches between the sims as described in the
  ticket (status connected / LMU buffer changed in the last 5 s, 5 s hysteresis).
- LMU lock-free copies: count of dropped inconsistent frames at 50 Hz in a busy session.

## Telemetry wiring (M1-6b)

- `main/telemetry-manager.ts` forks and restarts the process (backoff 0.5 s to 10 s) and brokers one
  port per overlay window at the highest rate requested (a higher rate brokers a new port; lower or
  equal does not). Ports are re-brokered after a process restart; a window's rate is forgotten on
  `did-start-loading`, `render-process-gone` and `destroyed`, and the reloaded page asks again.
- Source choice lives in `telemetry-settings.json` (tray: Data source). A missing replay file keeps
  Replay selected; the overlays show the error frames.
- Renderer: `renderer/telemetry/` (`TelemetryClient`, `useTelemetry`, `views.ts`). Renderers import
  frame types from `@overlay/sim-core/types` (type-only, no Node modules).
- Windows checks are listed in `docs/m1-acceptance.md`.

## M2 state (core five overlays, theme, settings)

- Integration branch: `claude/m2-integration`. All ticket branches (M2-0a to M2-20) and the wave A, B1 and B2 review fixes are merged into it. Nothing is on `main` yet; Peter approves the M2 PRs together after the acceptance list passes.
- Done: overlay host with per-overlay settings, scale and layout memory; Leaderboard, Relative, Spotter, Pit Speed and Fuel Calculator; theme presets, editor and share codes; Overlays, Appearance, General, Performance, Display and Developer pages; display fallbacks and safe mode; keep-fuel-data history.
- In progress: M2-21 (Developer page "Measure CPU", 3 % budget), built in parallel. M2-22 (visual snapshot tests) is deferred to M6.
- Needs Peter: work through `docs/m2-acceptance.md` on Windows with both sims and record the CPU numbers. Section 14 lists the guessed defaults he must confirm or change (fuel bar scale, pit stop info, gap threat thresholds, LMU "Limit not reported", Fuel "Max basis", refuel basis).
- Known open points (also in the checklist): the LMU spotter left/right sign was verified on a recording only; the LMU per-car value is fuel, not virtual energy; LMU pit stall and stop counting, iRacing grid positions and timed-race finish order need a live check. Options left out of M2 are listed per overlay in the checklist and go to M3 to M5 as planned.
