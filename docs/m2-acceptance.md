# M2 acceptance checklist (Windows PC)

Goal: prove the five core overlays (Leaderboard, Relative, Spotter, Pit Speed, Fuel Calculator), the theme system, the settings pages and the display fallbacks work on real iRacing and LMU. Record results next to each line, as in the M1 checklist. It is written to be done in two or three sessions: session 1 is the install, the settings pages and the CPU check (no sim needed for most), session 2 is iRacing, session 3 is LMU.

Tags: `[iR]` iRacing only, `[LMU]` LMU only. An untagged line applies to both sims. Items marked **Decide** are defaults we guessed and need your answer. Use plain notes ("the reference shows X, we show Y") for anything that differs.

All checks run on the integration build `claude/m2-integration` (CI installer artifact `overlay-windows-installer`). Nothing merges before this list passes.

## 0. Install and setup

- [ ] Install, or update over the M1 build, from the test build. Start the app; the tray icon appears and the settings window opens from it.
- [ ] iRacing and LMU both set to borderless windowed mode. The overlays sit above the game and do not steal focus or clicks.
- [ ] Tray, "Data source" submenu: with Developer tools off it shows only Auto, iRacing and LMU. With Developer tools on (Settings, Developer) it also shows Replay file... and Mock. The checked item matches the choice.
- [ ] Overlays page: the overlay list shows Leaderboard, Relative, Spotter, Pit Speed and Fuel Calculator, and no developer-only overlay while Developer tools are off.
- [ ] The sim filter on the Overlays page defaults to the connected sim (iRacing or LMU). Overlays that do not apply to that sim are greyed, but one that is already on can always be switched off.

## 1. Overlays page and settings that every overlay shares

- [ ] Switching an overlay on opens its window, off closes it.
- [ ] Opacity, Scale and (table overlays) Row opacity change the open overlay live as you drag the slider.
- [ ] Scale changed while the overlay is off: switch it on and it opens at the new size, not the old one.
- [ ] Hidden options: In garage, On track and Always show behave as named. [LMU] "Hide in garage" now follows the garage-stall flag: it hides while you are in the garage stall and shows again on track and in the pit lane.
- [ ] Columns list (table overlays): drag-reorder works with the mouse and the Move buttons work with the keyboard. Column width sliders change the table. A quick reorder followed straight away by a width change does not undo the reorder.
- [ ] Field toggles work, and a field greyed out for the other sim can still be switched off. [LMU] iRating and Safety rating columns are not shown as empty columns (they are iRacing only).
- [ ] Restart the app: positions, sizes, scale, fields and column order are all remembered.

## 2. Leaderboard (one line per option)

The option list from the requirements catalogue. "Left out" means we decided not to build it in M2.

- [ ] Row opacity.
- [ ] Column width: Custom / Auto / Compact; Width fine-tune %.
- [ ] Decimal places for Delta/Gap and for Lap time.
- [ ] Drivers around: Show all drivers; Above/below me; Top cars in my class; Top cars in other classes. With a 40-car field the expected rows appear around you.
- [ ] Name display: Driver name only; Team name only and Driver + team ([iR] only; hidden in LMU).
- [ ] Name format: Full name, F. Last, First L., Last only, First only, Last, F.
- [ ] Session display: Auto / Time remaining / Laps remaining.
- [ ] Layout: Session header; Show row labels; Show DQ limit.
- [ ] Left out of M2: Highlight incidents, Show penalty threshold (no per-car data yet; not in our option list), Show driver tags (M5). Note if you miss any.
- [ ] Header fields (pick up to 6): SoF, Incidents, Laps/time remaining, Sim time, Real time, Air temp, Track temp, Track wetness, Precipitation, Humidity, Fog level, Wind direction, Current lap, Brake bias. [LMU] shows "--" for SoF, incidents, precipitation, humidity, fog and wind.
- [ ] Visible fields: Position, Overall position, Car number, Car class, Driver name, Safety rating, iRating, Gap, Interval, Last lap, Best lap, Avg lap, Last lap delta, Best lap delta, Lap number, Pit lane, Pit stall, Last pitted, Stint lap, Prev stint, Pos change, Fuel % (LMU). Each shows a sensible value.
- [ ] Left out of M2 fields: Country flag, Flags, iRating change, Manufacturer, Push to pass, Tyre compound, Session info, Sim time and Real time as columns (no data in SimState, licensing questions, or no reference formula).
- [ ] Column order and Column widths (see section 1).
- [ ] Multi-class: coloured class header bars in the sim's class colours (iRacing multi-class; LMU Hypercar, LMP2, GT3). Single-class iRacing shows no class colour.

## 3. Relative (one line per option)

- [ ] Same controls as Leaderboard: Row opacity, Column width, Width fine-tune, decimals, Name display, Name format, Session display (tick the same lines as section 2).
- [ ] Drivers ahead and Drivers behind steppers (cars ahead above you, behind below).
- [ ] Hide cars in pits works through a whole pit cycle (the car disappears on entry and returns on exit). Cars that left the session do not show.
- [ ] Gap threat colours: a car closing from behind turns yellow then red. **Decide** (unconfirmed default): red at 1.0 s or less, yellow at 2.0 s or less. What should it be?
- [ ] Layout: Weather header; Show row labels; Session footer; Flag border follows the flag shown in the car; Show DQ limit.
- [ ] Header fields (up to 5) and Footer fields (up to 5) work.
- [ ] Visible fields as the Leaderboard, minus the class and overall columns.
- [ ] Gaps agree with the sim's own relative within a few tenths once the mini-sector data exists (after a lap or two).
- [ ] Left out of M2: Highlight incidents, Show penalty threshold, Show driver tags.
- [ ] Settings, Performance, Live position tracking on and off changes the position column in both Relative and Leaderboard (off = the sim's official positions, on = distance-based, updating mid-lap).

## 4. Spotter (one line per option)

- [ ] Space between bars (px), Bar length (px), Bar colour (picker with reset). We also have Bar width.
- [ ] Bar colour "Use theme accent" follows a theme change.
- [ ] [iR] A car alongside on the left lights the left bar, and the block slides from top to bottom as it drops back. Three-wide shows both sides.
- [ ] [LMU] A car alongside on your left lights the LEFT bar and one on your right lights the right bar (the left/right sign was only verified on a recording).
- [ ] [LMU] The block moves smoothly without flicker even though LMU updates cars at about 5 Hz.
- [ ] [LMU] The spotter also works in the pit lane (cars next to you while you are on pit road).
- [ ] Settings, Performance, Reduce visual effects on: no fades or sliding.
- [ ] Left out of M2: car-alongside audio and faster-class beeps (M5).

## 5. Pit Speed (one line per option)

- [ ] Visible: Pit stop info (plus our Speed, Limit and Limiter toggles).
- [ ] [iR] Speed and limit agree with the in-car display in km/h and mph. The bar flips to red above the limit. The overlay is hidden on track with the limiter off.
- [ ] [iR] **Decide** (unconfirmed default): pit stop info shows "Box in N m" counting down to your stall, then "In pit stall" while stopped. Is that what you want?
- [ ] [LMU] Speed and limiter state are right. **Decide**: LMU does not report the pit limit, so we show "Limit not reported" instead of the bar. Acceptable, or do you want a manual limit setting?

## 6. Fuel Calculator (one line per option)

- [ ] Layout Vertical / Horizontal.
- [ ] Safety margin (laps).
- [ ] Live fuel updates: off means the targets change only at the start/finish line.
- [ ] Keep fuel data (see section 11).
- [ ] Visible: Consumption, Fuel history, Fuel level, Fuel-to-finish targets, Laps left avg/last/worst, Laps remaining, Pit window, Refuel amount, Usage avg 10 / avg 5 / last lap.
- [ ] Fuel bar and litres/percent, laps remaining, stint time. **Decide** (unconfirmed default): fuel history bars show 100% = the largest lap use of the last 5 laps. Is that the scale you want?
- [ ] [iR] In a race, after 2 valid laps the pit window and refuel amount appear. LAST / AVG 5L / AVG 10L agree with the reference values within rounding. With zero refuel needed the overlay says "No stop needed".
- [ ] **Decide** (unconfirmed default): refuel = shortfall to the finish plus the safety margin, capped at one tank, using the session average. Should it use the 5-lap average instead? Compare the refuel amount against the pit box.
- [ ] Imperial units show gallons.
- [ ] [LMU] With virtual energy: values in %, and the refuel figure matches what the LMU pit menu needs. Energy thresholds were never tuned on a clean lap recording, so note odd laps.
- [ ] Left out of M2: "Max basis Session / Tank" (not mapped; we always use the max lap use of the last 5), Auto fuel from 5-lap average (pit-box writes, M5), Team fuel sharing (Release 3).

## 7. Sim data checks (these need the real sims)

- [ ] [LMU] The per-car "Fuel % (LMU)" column is fuel, not virtual energy. Compare with the sim: the number should match LMU's fuel display for other cars. Per-car virtual energy is deferred; say if you need it.
- [ ] [LMU] Pit stall and pit stop counting: Last pitted, Prev stint and Stint lap update after a real stop. A drive-through does NOT count as a stop and does not reset the stint. The first drive out of the garage is not counted as a stop.
- [ ] [iR] Grid start positions: on the grid before the green, Pos change shows the change versus the starting grid. Stint lap on a grid start counts from 0 (a 12-lap race ends at 12).
- [ ] [iR] Timed race finish order: when the timed race ends, the order stays correct. A lapped car that crosses the line after the winner is not promoted to P1.
- [ ] Leaderboard after the flag (both sims): drivers who drive off to the garage or leave the world keep their finishing place; the order matches the sim's official results.
- [ ] Qualifying to race session change: the tables reset and fill again, no stale rows, and the Fuel Calculator restarts its lap count.
- [ ] [iR] Wind direction in the header: a compass point showing the direction the wind comes FROM. Compare with the iRacing weather screen.
- [ ] Brake bias in the header: matches the in-car value (front %), in both sims. Some LMU cars report an offset and show "--".
- [ ] Class colours on car numbers and class badges match the sim.
- [ ] Hide cars in pits (Relative) and the Pit lane column (Leaderboard) follow a full pit cycle.

## 8. Theme

- [ ] Appearance page: the preset gallery lists the presets. Clicking one recolours every open overlay at once.
- [ ] Font (all four: Manrope, Oswald, Inter, Barlow Condensed), weight, and Compact mode changes show in open overlays. Each font really renders (not a fallback) in the gallery and in the overlays.
- [ ] Built-in themes are read-only: with a preset active, the colour editor, font, weight and Compact mode controls are disabled and a note says built-in themes can't be changed. "New theme from this…" asks for a name (default "<preset> copy"), creates the theme and makes it active; its controls are editable. "New theme" is also available while a custom theme is active. Creating a 51st theme shows the 50-theme limit error.
- [ ] Switching presets in the gallery while an edit is still pending does not put the edit on the newly selected theme.
- [ ] Colour editor: editing a colour updates open overlays once per release of the picker (not on every drag step). Contrast warnings appear for low-contrast pairs. The live preview matches.
- [ ] Locked colours (licence classes, flags and similar) cannot be edited in the editor.
- [ ] Share code round trip: copy a code on install A, paste and import on install B (or a second user-data folder): same look.
- [ ] Share by file: export a file, import it on the other install: same look.
- [ ] A crafted code that tries to set a locked colour imports with the locked colours unchanged. (Hand-edit a code, or ask for a prepared one.)
- [ ] Combine safety & iRating tints the iRating pill with the licence colour. Licence pill text is readable on every class colour (class B has dark text).

## 9. Units and time

- [ ] General page: Units Metric / Imperial, Keep car speed in mph, Time format 24 h / 12 h.
- [ ] Every overlay reflects them: Pit Speed (km/h or mph), Fuel (litres or gallons), temperatures and wind in Leaderboard and Relative headers, session times and clocks in 12 h or 24 h.

## 10. Settings pages

- [ ] Overlays: sections 1 to 6 above.
- [ ] Appearance: section 8.
- [ ] General: UI scale (100 / 110 / 125 / 150 %) resizes the window; Start with Windows is offered only in the installed app; Hide overlays when no sim is running works; Units and Time format as section 9.
- [ ] Performance: Reduce visual effects; Live position tracking; Telemetry update rate (60 / 30 Hz) takes effect on the open overlays.
- [ ] Display: the fallbacks (Disable hardware acceleration, Disable DirectComposition, Transparency fix, Disable native window occlusion) can be switched on; a "Restart now" button appears and restarts the app with them applied.
- [ ] Display: start with `--safe-mode` (shortcut argument). A safe-mode note is shown with a "Restart normally" button, which restarts without safe mode. Safe mode alone does not ask for a restart.
- [ ] Developer: Data source (Auto / iRacing / LMU / Replay file / Mock), fixture recording status, LMU frames per second, Resource usage table refreshes about every 2 s.
- [ ] Developer tools off then on: the tray Data source submenu shows Replay file... and Mock only while on. Dev-only overlays (for example Demo Inputs) can only be opened while on, and are closed automatically when you turn Developer tools off.

## 11. Fuel data kept across sessions

- [ ] [iR] Run 3 valid laps, quit, start a new session in the same car and track with Keep fuel data on: the Fuel Calculator shows averages and a refuel amount on lap 1. With it off, it waits for 2 laps as before.
- [ ] [LMU] Same in energy %. History is keyed on class and car model, not the team livery: a different livery of the same car still finds its history.
- [ ] `fuel-history.json` appears in the user-data folder and survives an app restart.

## 12. Corrupt settings files

- [ ] Close the app, damage one settings JSON in the user-data folder (for example the theme or overlay settings file: add a stray character), start the app. It starts with defaults and the bad file is renamed to `<name>.bad-<timestamp>` next to it, not deleted. A later change does not overwrite the set-aside copy.

## 13. Performance (CPU check)

Settings, Developer page, "Measure CPU" (ticket M2-21, built in parallel; if the button is missing, note the build). It runs phase A (all overlays closed, 60 s) and phase B (the five core overlays open, 60 s) while a sim is running, and the budget is a difference of at most 3 % of the whole machine. Results are saved under `perf/` in the user-data folder.

- [ ] iRacing, session with cars on track. Phase A ____ %, phase B ____ %, difference ____ % (budget 3 %). Pass / fail: ____
- [ ] LMU. Phase A ____ %, phase B ____ %, difference ____ %. Pass / fail: ____
- [ ] Machine and settings for the record (CPU, telemetry rate, Leaderboard with all fields?): ____
- [ ] Resource usage table: "Utility: overlay-telemetry" stays under 5 % CPU with the five overlays showing: ____ %
- [ ] Note the saved result file names from `perf/`.

## 14. Questions for Peter (unconfirmed defaults, answer in the notes)

1. Fuel bars: 100 % = largest lap use of the last 5. OK?
2. Pit stop info: distance to box plus "In pit stall". OK?
3. Gap threat: red up to 1.0 s, yellow up to 2.0 s. OK?
4. LMU Pit Speed: "Limit not reported". OK?
5. Fuel "Max basis Session / Tank": not mapped. Do you use it?
6. Refuel amount: shortfall + margin, capped at one tank, from the session average. Should it use the 5-lap average?
7. Should a drive-through count as a pit stop?
8. Anything on the "left out of M2" lines you want sooner?
