# Main window acceptance checklist (Windows PC)

Goal: prove the new main window works. It replaces the old settings window. Do this together with `docs/m2-acceptance.md`, which now assumes the main window.

Record a result next to each line. Use plain notes for anything that looks wrong. Tick a line only if it works as written.

Test build: `claude/mw-integration` (CI installer artifact `overlay-windows-installer`). Nothing merges before this list passes.

## 1. Launch and tray

- [ ] Start the app by hand. One window called "Overlay" opens. The tray icon appears.
- [ ] The window opens at about 1280 by 820 and fits your screen.
- [ ] Start the app a second time while it runs. No second copy starts. The existing window comes to the front.
- [ ] Double-click the tray icon. The window opens and gets focus.
- [ ] Tray menu: "Open Overlay" opens the window. There is no "Show settings" item.
- [ ] Tray menu: "Overlays visible" and "Overlays locked" are checkbox items. They show the true state.
- [ ] Move and resize the window. Quit and start again. It opens where you left it.

## 2. Close to tray

- [ ] Click the close button. The window hides. The overlays keep running.
- [ ] The first time, a tray notice says "Overlay is still running. Open it from the tray icon." It does not appear the second time.
- [ ] General: set "When I close the window" to Quit. Click close. The app quits and the overlays disappear.
- [ ] Set it back to "Keep running in the tray". Tray menu, Quit also quits the app.
- [ ] Top bar menu, "Quit Overlay" quits the app.

## 3. Start with Windows

- [ ] General: "Start with Windows" on, "Start hidden when Windows starts" on. Sign out and in. The app starts with only the tray icon. No window pops up.
- [ ] Switch "Start hidden" off. Sign out and in. The window opens.
- [ ] With "Start hidden" on, starting the app by hand still opens the window.

## 4. Top bar

- [ ] The game selector shows Auto, iRacing and LMU. With Developer tools on it also shows Replay and Mock.
- [ ] Choosing a game changes the data source at once. The status dot and label follow the connection.
- [ ] Visible off hides every overlay. On shows them again.
- [ ] Locked on: clicks go through the overlays to the game. Locked off: you can drag and resize the overlays on screen.
- [ ] Press Ctrl+Shift+F10. The Locked switch in the top bar follows.
- [ ] Change Visible and Locked from the tray. The top bar follows. Change them in the top bar. The tray checkboxes follow.
- [ ] General: turn on "Minimise when a game connects". Start the sim. The window minimises when the sim connects. With the option off, it does not.

## 5. Overlays page

- [ ] First run (or a fresh user-data folder): a welcome card shows. "Got it" hides it for good.
- [ ] Layout: Active and Available lists on the left, settings in the middle, preview on the right.
- [ ] Make the window narrow (about 1000 px wide). The preview moves above the settings and stays in view.
- [ ] Each overlay has an on/off switch. On opens it on screen. Off closes it.
- [ ] Greyed items follow the game selector. On Auto with no sim running, nothing is greyed. An overlay that is already on can always be switched off.
- [ ] Sections fold and unfold: Appearance, Visibility, Columns or Fields, Header and footer, then the overlay's own sections.

## 6. Live preview

The preview uses demo data. It shows the overlay at its real on-screen size, scaled down to fit. Under it a line gives the size.

For each of Leaderboard, Relative and Fuel Calculator, change every option on the page. The preview must change at once and look the same as the real overlay.

- [ ] Leaderboard: Row opacity, Column width, Width fine-tune, decimals, Drivers around, Name display, Name format, Session display, layout toggles, every header field, every column toggle.
- [ ] Relative: the same table options, plus Drivers ahead and behind, Hide cars in pits, Colour by car status, Weather header, Session footer, header and footer fields.
- [ ] Fuel Calculator: Layout Vertical and Horizontal, Safety margin, and each other option.
- [ ] Opacity and Scale change the preview. Scale also changes the size line.
- [ ] Switch the theme on the Appearance page. The preview follows.
- [ ] Minimise the window for a minute. Open it again. The preview picks up again and nothing is stuck.
- [ ] Change the UI scale in General. The window changes size. The preview still matches the real overlay.
- [ ] Task Manager: with the window open on a table overlay, the app's CPU stays low. Note the figure. Developer, "Measure CPU" still gives a pass.

## 7. Columns and widths

- [ ] Drag a column by its handle to reorder. The Move up and Move down buttons work with the keyboard.
- [ ] Each column has a show switch, a width slider with a number, and a reset button.
- [ ] Each slider stops at a minimum. A mark shows it. Help text says "Narrowest readable width".
- [ ] Drag a slider to its minimum. The column in the preview is still readable. No text is cut off.
- [ ] Below the list: "Total N %. The Driver column takes the rest." Push the total above 100 %. The note says the overlay will widen to fit.
- [ ] Column width is Auto or Compact. Move a width slider. Column width switches to Custom and the note "Column width set to Custom" shows.
- [ ] Change Width fine-tune. The slider minimums move to match.
- [ ] A quick reorder followed straight away by a width change keeps both.
- [ ] Restart the app. Order, visibility and widths are remembered.

## 8. Header and footer

- [ ] Header fields show as chips in the order you picked. Drag a chip to reorder. The left and right keys also move it.
- [ ] Under the chips, a grid of tick boxes with a counter such as "3 of 5". When the list is full, the unticked boxes are disabled.
- [ ] A field for the other sim shows a badge. You can still untick it.
- [ ] The limit holds for each overlay: Leaderboard 6 header fields, Relative 5 header and 5 footer fields.
- [ ] The preview header and footer follow every change.

## 9. Other pages

- [ ] General has no "Data source". It has "Start hidden when Windows starts", "When I close the window" and "Minimise when a game connects".
- [ ] The UI scale help text reads "Scales this window only".
- [ ] Appearance, Performance, Display and Developer (with Developer tools on) still work.
- [ ] The overlays sit above the main window. Note if they cover controls you need. Say where they were.

## 10. Wrap-up

- [ ] Anything that looks wrong, slow or confusing. Write it here.
- [ ] Decide: should the close button keep the overlays running in the tray (current default)?
- [ ] Decide: should the app start hidden at login (current default: yes)?
- [ ] Decide: should the window minimise when a game connects (current default: off)?
