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
- [] No taskbar button for the overlays. - Unsure how to test

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
