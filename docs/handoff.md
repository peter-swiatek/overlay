# Handoff

Last updated 2026-10-30.

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
