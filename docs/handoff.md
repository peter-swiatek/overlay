# Handoff

Last updated 2026-10-30.

- Release 1 architecture approved; M0 starting.
- Repo was empty; `main` holds only README and docs until the M0 PRs merge.
- Open questions for Peter: none yet. The Garage 61 spike will need his personal access token.

## Telemetry core (M1-6a)

`apps/desktop/src/telemetry/` is the utility process that turns sim memory into `TelemetryFrame`s
(`packages/sim-core/src/telemetry`). Main-process wiring and the renderer client are M1-6b.

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
