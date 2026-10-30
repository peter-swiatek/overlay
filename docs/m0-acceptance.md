# M0-2 acceptance checklist (Windows PC)

Goal: prove the overlay windows behave over a running sim. Record results next to each line.

## Install

- [X] Download the `overlay-windows-installer` artifact from the CI run, unzip, run `Overlay-Setup-<version>.exe`. It is unsigned, so SmartScreen warns: More info, Run anyway. Install is per-user (no admin prompt).
- [X] A tray icon (amber square) appears, and the app starts quietly (the settings window does not open by itself, so it cannot steal focus from the sim). Open it from the tray: double-click the icon or choose "Show settings".

## With the sim running

Run iRacing, then LMU, each in **borderless windowed** mode, on the same monitor as the overlays.

- [X] Both overlays ("Demo Relative" table, "Demo Inputs" bars) show above the sim and stay on top.
- [X] No black or opaque rectangle behind them; the sim is visible through the transparent area.
- [X] Table updates smoothly (10 Hz); bars move smoothly (60 Hz).
- [X] Click-through: clicking, scrolling the mouse wheel and pressing keys over an overlay reaches the sim:
- [X] Focus: the sim never loses focus when overlays appear or update (no alt-tab flicker, no pause, wheel and pedal/keyboard input keep working).
- [ ] Re-test: click on the sim, then check the overlays are still on top. The app re-raises the overlays (without focusing them) whenever the foreground window changes. If the overlays flicker or still lose to the sim, note which sim and its display mode.
- [ ] No taskbar button for the overlays. How to check: look at the Windows taskbar while the overlays are showing. Pass = no "Overlay" button for them (only the tray icon, plus the settings window button when it is open). Previously: unsure how to test.

## Edit mode

Toggle with the tray menu or Ctrl+Shift+F10.

- [X] Overlays show a dashed amber outline and their name.
- [X] Drag an overlay by its frame; it moves.
- [X] Drag the bottom-right grip; it resizes and stops at a minimum size.
- [X] Leave edit mode: overlays are click-through again and the sim keeps focus.
- [X] Quit from the tray, start again: positions and sizes are restored.
- [X] "Toggle overlays visible" hides and shows both without stealing focus.

## Performance

- [X] Note the CPU % and memory per process type from the settings window readout (refreshes every 2 s) while the sim runs: 1.1 CPU and 520mb memory
- [X] Note Overlay's CPU and GPU in Task Manager (Details tab, add the GPU column) and any sim frame-rate change: 1% CPU and 1% GPU

## If the overlays are black

Enable one fallback at a time in the settings window, restart the app (tray, Quit, then start it again), and re-check. Report which one fixed it.

1. [ ] Disable DirectComposition
2. [ ] Opacity workaround (0.99)
3. [ ] Disable hardware acceleration
4. [ ] Still black: start with `--safe-mode` (all three at once) and report the result.

Also report GPU model, Windows version, monitor setup, and the sim's display mode.

## Recording fixtures (M0-6)

The app can record what iRacing and LMU expose, so we can build and test the M1 adapters against real data. It only reads: shared memory is opened read-only and the only network calls are GET requests to LMU's local REST API (`127.0.0.1:6397`). It never writes to the games.

### How to record

1. Start Overlay. In LMU, make sure Settings > Gameplay > "Enable Plugins" is ON (restart the game after changing it).
2. Tray icon > **Start recording**. The settings window shows "Waiting for iRacing or LMU", then the current file, its size and frames per second. Recording starts by itself when a sim is detected and switches file when you change sim. A new file also starts every 60 minutes.
3. Drive. Use tray > **Mark moment** whenever something interesting happens, and pick a label (quali -> race, pit stop, driver swap, incident, other). In LMU a mark also records a burst of 1,000 consecutive frames. Each LMU REST endpoint is sampled about every 20 s (one request per second, rotating through them).
4. Tray icon > **Stop recording** when done. Quit from the tray also finishes the file properly.

Use tray > **Open fixtures folder** to find the files (they are named `<sim>-<UTC time>.ovfx`). Expect about 2 MB per minute for LMU at the default rate and less for iRacing, but real sessions may be larger.

### What to record

iRacing (one continuous recording is best):

- [X] A full weekend in one go: practice, then qualifying, then race (mark "quali -> race" at each transition). A short session length is fine.
- [ ] A pit stop with refuel (mark "pit stop" on entry).
- [ ] An offline test session (a few laps).

LMU:

- [ ] A hybrid car (with virtual energy), a few laps plus a pit stop. - partial, getting FFB issues unrelated to the overlay
- [ ] A GT3 car (plain fuel), a few laps plus a pit stop with refuel.
- [ ] Rain, if you can get it (a wet or changing-weather session).
- [ ] One online session (practice or race), if possible.
- [ ] Start each LMU recording while still in the menu or garage, so the start of the file shows those states, then go on track.

### How to send them

Quit the app from the tray (so every file is finalised), zip the whole `fixtures` folder and upload the zip to the project. The files are large and already compressed, so a normal zip is fine. If a file is cut short because the app or the PC crashed, send it anyway: it can still be read up to the last second.

### What the settings window shows

Under "Fixture recording": status, current file, size in MB, and frames per second for each sim. "LMU frames per second" (1 to 20, default 5) sets the full-buffer rate for LMU. Higher rates make much bigger files.
