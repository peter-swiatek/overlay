# M1-6 acceptance checklist (Windows PC)

Goal: prove the overlays show live telemetry, from the telemetry utility process, next to fixture capture. Record results next to each line.

## Install

- [X] Install the CI build of this branch (`overlay-windows-installer` artifact). Start the app; the tray icon appears.
- [X] Tray, "Data source" submenu lists Auto, iRacing, LMU, Replay file..., Mock, and the checked item matches the choice (default: Auto).

## Live data

- [X} iRacing running (borderless windowed): "Demo Relative" shows up to three cars ahead, you, and up to three behind, with class colour, car number, name and gap (negative = ahead, positive = behind). "Demo Inputs" shows brake, throttle and clutch bars, gear, speed and steering, moving smoothly.
- [X] LMU running: the same two overlays show LMU data.
- [X] With no sim running the overlays say "Waiting for sim" (no stale numbers).
- [X] Switching sims works without restarting the app: with Auto, quit iRacing and start LMU (and back); the overlays follow within about 5 s. Choosing iRacing or LMU explicitly in the tray also switches at once.

## Replay and Mock - not tested in full

- [ ] Tray > Data source > Replay file..., pick an `.ovfx` recording (for example one captured earlier). The overlays play it back and the menu checks "Replay file...".
- [ ] Restart the app: the replay choice and file are remembered. Rename the file and restart: Replay stays selected and the overlays show the error text.
- [X] Mock: the overlays show synthetic data.

## Capture coexistence

Both the capture and telemetry processes read the sims' shared memory and are left running together.

- [X] Start recording from the tray with overlays running in iRacing. The settings window shows capture at 55 frames/s or more for iRacing. If it drops below that, note the numbers: both processes may wait on `IRSDKDataValidEvent`, and if iRacing created it as an auto-reset event one signal wakes only one of them (see the capture coexistence item in `docs/handoff.md`).
- [X] The overlays still update smoothly (inputs about 60 Hz) while recording.
- [ ] Settings window, Resource usage: the "Utility: overlay-telemetry" row stays under 5% CPU while iRacing is running with both overlays showing. Note the value, and the "Utility: overlay-capture" row for comparison.

## Packaged app

- [ ] The YAML worker is found in the installed app: with iRacing running, driver names, car numbers and class colours appear in "Demo Relative" (they come from the session YAML worker, `telemetry-session-worker.js`, next to `telemetry.js`). If rows show "Car 12"-style names or no colours, the worker was not found. - Names appear but issues present, will provide screenshot, no class colours
- [ ] Kill the "overlay-telemetry" process in Task Manager (Details, a second `Overlay.exe` utility process): the overlays recover within a few seconds without restarting the app.
- [X} Quit from the tray: no `Overlay.exe` processes are left behind.
