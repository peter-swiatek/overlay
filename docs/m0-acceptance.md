# M0-2 acceptance checklist (Windows PC)

Goal: prove the overlay windows behave over a running sim. Record results next to each line.

## Install

- [ ] Download the `overlay-windows-installer` artifact from the CI run, unzip, run `Overlay-Setup-<version>.exe`. It is unsigned, so SmartScreen warns: More info, Run anyway. Install is per-user (no admin prompt).
- [ ] A tray icon (amber square) appears, and the settings window opens.

## With the sim running

Run iRacing, then LMU, each in **borderless windowed** mode, on the same monitor as the overlays.

- [ ] Both overlays ("Demo Relative" table, "Demo Inputs" bars) show above the sim and stay on top.
- [ ] No black or opaque rectangle behind them; the sim is visible through the transparent area.
- [ ] Table updates smoothly (10 Hz); bars move smoothly (60 Hz).
- [ ] Click-through: clicking, scrolling the mouse wheel and pressing keys over an overlay reaches the sim.
- [ ] Focus: the sim never loses focus when overlays appear or update (no alt-tab flicker, no pause, wheel and pedal/keyboard input keep working).
- [ ] No taskbar button for the overlays.

## Edit mode

Toggle with the tray menu or Ctrl+Shift+F10.

- [ ] Overlays show a dashed amber outline and their name.
- [ ] Drag an overlay by its frame; it moves.
- [ ] Drag the bottom-right grip; it resizes and stops at a minimum size.
- [ ] Leave edit mode: overlays are click-through again and the sim keeps focus.
- [ ] Quit from the tray, start again: positions and sizes are restored.
- [ ] "Toggle overlays visible" hides and shows both without stealing focus.

## Performance

- [ ] Note the CPU % and memory per process type from the settings window readout (refreshes every 2 s) while the sim runs: ______
- [ ] Note Overlay's CPU and GPU in Task Manager (Details tab, add the GPU column) and any sim frame-rate change: ______

## If the overlays are black

Enable one fallback at a time in the settings window, restart the app (tray, Quit, then start it again), and re-check. Report which one fixed it.

1. [ ] Disable DirectComposition
2. [ ] Opacity workaround (0.99)
3. [ ] Disable hardware acceleration
4. [ ] Still black: start with `--safe-mode` (all three at once) and report the result.

Also report GPU model, Windows version, monitor setup, and the sim's display mode.
