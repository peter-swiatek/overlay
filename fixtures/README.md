# Fixture slices

Small, committed excerpts of Peter's recorded sessions, used by tests. Format: `.ovfx`, see
`packages/sim-core/src/fixtures/format.ts`. Times are seconds after the first record of the source
recording (the `--from`/`--to` of the slicer). Every slice header carries `sliceOf`, `fromS` and
`toS`, and every slice is self-contained: the latest iRacing header and session YAML, or the latest
LMU REST responses and marker, are re-emitted at the first kept frame's time.

| File                                     | Source recording                                                         | Range          | Size    | Shows                                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------ | -------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `iracing-ferrari-race-start-20s.ovfx`    | `iracing-20261030T074730Z.ovfx` (VIR, Ferrari 296 GT3)                   | 805 to 825 s   | 1.2 MB  | Parade laps ending, green flag (SessionState 3 to 4 at 811.95 s), first S/F crossing of the race at 815.77 s. About 1,160 var buffers (57 Hz).                       |
| `iracing-ferrari-sf-crossing-20s.ovfx`   | same                                                                     | 1360 to 1380 s | 1.2 MB  | Mid-race, race running (SessionNum 2, state 4); lap counter goes 5 to 6 at 1369.58 s, LapDistPct wraps 1 to 0.                                                       |
| `iracing-ferrari-quali-to-race-10s.ovfx` | same                                                                     | 559 to 569 s   | 0.15 MB | Qualifying cooldown (SessionNum 1, state 6) then the race session starting (SessionNum 2, state 1 "get in car" at 564.47 s). Session YAML changes at the transition. |
| `lmu-hypercar-onpace-10s-5hz.ovfx`       | `lmu-20261030T084243Z.ovfx` (Le Mans, Ferrari 499P, Practice 1, 37 cars) | 105 to 115 s   | 1.1 MB  | Steady 5 Hz running, gamePhase 5 (on track); 49 sync/buffer pairs and the REST polling (standings, sessionInfo, strategy, garage).                                   |
| `lmu-burst-first-5s.ovfx`                | same                                                                     | 0 to 5 s       | 4.6 MB  | The start-of-recording burst: 244 frames at about 50 Hz, before the first REST poll answers.                                                                         |

Total: about 8.2 MB.

## Privacy

The recordings come from online sessions. Slices are redacted by the slicer:

- iRacing: in the session YAML records and in the live YAML copy inside the irsdk header record,
  `UserName`, `AbbrevName`, `Initials` and `TeamName` become `Driver <carIdx>` (Peter's car too),
  `UserID`, `DriverUserID` and non-zero `TeamID` become synthetic numbers, `TelemetryDiskFile`
  is blanked.
- LMU: driver names (and abbreviations such as the pit menu's `F Last`) are replaced in REST bodies
  (`Driver <slotID>`). In the raw `LMU_Data` buffer the name fields are overwritten by offset
  (see `adapters/lmu/layout.ts`): every driver name becomes `Driver <id>`, the player name too, the
  player file name becomes `player`, the user-data path block becomes `C:\LMU\path<n>`, Steam IDs
  are zeroed and the results stream (free text with names) is zeroed. A name search over the
  whole buffer then runs as a second net. Team names become `Team <slotID>` in REST. Car and
  livery names are game content and stay.

Make a new slice with `pnpm --filter @overlay/sim-core slice <in> <out> --from <s> --to <s>`
(use absolute paths; pnpm runs the script from `packages/sim-core`), and check it with
`packages/sim-core/src/fixtures/committed-fixtures.test.ts` before committing.
