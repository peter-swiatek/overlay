/**
 * Byte offsets of the `LMU_Data` shared-memory mapping, as observed in recorded buffers
 * (game build 14200). All multi-byte values are little-endian, all structs are 4-byte packed
 * (so an f64 can start at any multiple of 4).
 *
 * Provenance: offsets and types are numeric facts derived from observation. Each one was found
 * in the committed fixture slices and Peter's 39 minute Le Mans recording, and cross-checked
 * against the `/rest/watch/standings` and `/rest/watch/sessionInfo` bodies recorded next to the
 * buffers. The names and comments here are our own; where REST has a name for a value we use
 * that vocabulary, otherwise a descriptive name of ours.
 *
 * The mapping is 327,680 bytes; the sim writes the first 324,820 and the rest stays zero.
 *
 *   0       header      event counters u32[16], game build number
 *   332     paths       5 x 260 byte NUL-padded strings (install and user-data folders)
 *   1632    scoring     session block (560 bytes), 104 vehicle rows (584 bytes each),
 *                       then a 65,536 byte results/message stream (XML-ish text, names inside)
 *   128464  telemetry   3 count bytes + 1 pad, then 104 rows of 1,888 bytes (37 used in the
 *                       recording, in scoring order except that the player's row is last)
 *
 * Evidence column legend: REST = same value found in a `/rest/watch/*` body recorded in the same
 * slice; DATA = confirmed from a value pattern in the buffer itself (and the physical sanity of
 * it over the full recording); LOCAL = checked against the 39 minute local recording only.
 */

export const LMU_MAPPING_BYTES = 327_680;
/** Bytes the sim actually fills; the end of the last telemetry row. */
export const LMU_USED_BYTES = 324_820;
export const LMU_MAX_VEHICLES = 104;

export const HEADER = {
  /** i32. Game build number, 14200 in the recording. REST: `/navigation/state` appBuild 14200. */
  appBuild: 64,
} as const;

export const PATHS = {
  offset: 332,
  count: 5,
  size: 260,
} as const;

/** Start of the scoring block; the session fields below are relative to it. */
export const SCORING_BASE = 1632;

/**
 * Session block. Evidence per field:
 *
 * | field            | type    | evidence                                                    |
 * | ---------------- | ------- | ----------------------------------------------------------- |
 * | trackName        | cstr 64 | REST sessionInfo.trackName "Circuit de la Sarthe"           |
 * | sessionCode          | i32     | 1 while REST session = PRACTICE1 (see {@link sessionTypeOf})|
 * | currentEventTime        | f64     | REST currentEventTime, same ET +- one 5 Hz tick             |
 * | endEventTime            | f64     | 3605 = REST maxTime 3600 + 5 s start offset; endEventTime - currentEventTime equals REST timeRemainingInGamePhase |
 * | maximumLaps          | i32     | 0x7fffffff while REST maximumLaps is 4294967295 (timed)     |
 * | lapDistance          | f64     | REST lapDistance 13623.9677734375, bit-exact                |
 * | numberOfVehicles      | i32     | REST numberOfVehicles 37, standings length 37               |
 * | gamePhase        | u8      | 5 while REST gamePhase 5 and every standings row GREEN      |
 * | yellowFlagState  | i8      | REST yellowFlagState "NONE" while 0 (other values: LOCAL)   |
 * | numRedLights     | u8      | REST numRedLights 5                                         |
 * | inRealtime       | u8      | REST inRealtime true                                        |
 * | playerName       | cstr 32 | REST playerName (redacted slices: "Driver 0")               |
 * | playerFileName   | cstr 64 | REST playerFileName "Settings"                              |
 * | raining          | f64     | REST raining 0                                              |
 * | ambientTemp      | f64     | REST ambientTemp to the last digit, degrees Celsius         |
 * | trackTemp        | f64     | REST trackTemp to the last digit, degrees Celsius           |
 * | minPathWetness   | f64     | REST minPathWetness 0 (dry in the whole recording)          |
 * | maxPathWetness   | f64     | REST maxPathWetness 0 (dry in the whole recording)          |
 * | averagePathWetness   | f64     | REST averagePathWetness 0 (dry in the whole recording)      |
 * | serverName       | cstr 32 | REST serverName "-none-"                                    |
 * | timeOfDay        | f32     | REST GetGameState timeOfDay within 3 s on 114 of 114 paired frames (the REST body is up to a second older); advances exactly 1.0000 s per session second; seconds after midnight, can pass 86,400 |
 *
 * Searched and not provable here: the wind vector (REST sessionInfo windSpeed and the public
 * struct order put it at 244, three f64, but both were exactly 0 in the whole recording, so the
 * offset is not proven) and `raining` above, which was also 0 throughout. Neither is decoded.
 * The pit speed limit is nowhere: no f32/f64 near 60, 80, 50 km/h (or in m/s) exists at a fixed
 * place in any buffer region, and no REST body names one.
 */
export const SESSION = {
  trackName: { offset: 0, length: 64 },
  sessionCode: 64,
  currentEventTime: 68,
  endEventTime: 76,
  maximumLaps: 84,
  lapDistance: 88,
  numberOfVehicles: 104,
  gamePhase: 108,
  yellowFlagState: 109,
  numRedLights: 114,
  inRealtime: 115,
  playerName: { offset: 116, length: 32 },
  playerFileName: { offset: 148, length: 64 },
  raining: 220,
  ambientTemp: 228,
  trackTemp: 236,
  minPathWetness: 268,
  maxPathWetness: 276,
  averagePathWetness: 332,
  timeOfDay: 344,
  serverName: { offset: 296, length: 32 },
} as const;

/** Where the vehicle rows start, relative to the scoring block (the session block is 560 bytes). */
export const VEHICLE_ROWS_OFFSET = SCORING_BASE + 560;
export const VEHICLE_STRIDE = 584;

/** The results stream directly follows the 104 vehicle rows. */
export const RESULTS_STREAM = {
  offset: VEHICLE_ROWS_OFFSET + LMU_MAX_VEHICLES * VEHICLE_STRIDE,
  length: 65_536,
} as const;

/**
 * One scoring row (offsets relative to the row). Evidence is a comparison with the standings row
 * whose `slotID` equals `id`, in the same slice.
 *
 * | field          | type    | evidence                                                         |
 * | -------------- | ------- | ---------------------------------------------------------------- |
 * | slotId             | i32     | standings slotID                                                 |
 * | driverName     | cstr 32 | standings driverName                                             |
 * | vehicleName    | cstr 64 | standings vehicleName (team, season, number, livery tag)         |
 * | lapsCompleted      | i16     | standings lapsCompleted                                          |
 * | sector         | i8      | standings sector: 1 SECTOR1, 2 SECTOR2, 0 SECTOR3               |
 * | finishStatus   | i8      | standings finishStatus: 0 FSTAT_NONE (other values unobserved) |
 * | lapDistance        | f64     | standings lapDistance, within the 1 s between a buffer and REST  |
 * | pathLateral    | f64     | standings pathLateral                                            |
 * | trackEdge      | f64     | standings trackEdge                                              |
 * | bestSectorTime1/2 | f64     | standings bestSectorTime1/2 (-1 until set)                       |
 * | bestLapTime    | f64     | standings bestLapTime (-1 until set)                             |
 * | lastLapTime    | f64     | standings lastLapTime (0 until set)                              |
 * | pitstops    | i16     | standings pitstops                                               |
 * | penalties   | i16     | standings penalties                                              |
 * | player       | u8      | standings player                                                 |
 * | inControl        | i8      | standings inControl: 0 on the player, 1 on the others (no other values seen) |
 * | pitting         | u8      | standings pitting                                                |
 * | position          | u8      | standings position                                               |
 * | carClass   | cstr 32 | standings carClass                                               |
 * | timeBehindNext | f64     | standings timeBehindNext                                         |
 * | timeBehindLeader | f64   | standings timeBehindLeader                                       |
 * | lapStartTime     | f64     | standings lapStartET                                             |
 * | worldPos       | f64 x3  | standings carPosition x, y, z                                    |
 * | carVelocity       | f64 x3  | standings carVelocity x, y, z                                    |
 * | orientation    | f64 x9  | standings orientation matrix, three rows of three; the car's nose is minus the third column (matched the direction of motion within 10 degrees on 1,854 of 1,931 moving frames) |
 * | pitState       | u8      | standings pitState: 0 NONE, 5 EXITING (1-4 not observed: no stop) |
 * | qualification  | i32     | standings qualification                                         |
 * | timeIntoLap    | f64     | standings timeIntoLap                                            |
 * | estimatedLapTime     | f64     | standings estimatedLapTime                                       |
 * | flag           | u8      | standings flag (GREEN = 0; blue = 6 is LOCAL)                    |
 * | underYellow    | u8      | standings underYellow                                            |
 * | inGarageStall  | u8      | standings inGarageStall                                          |
 * | steamID        | u64     | standings steamID (0 in the recording; zeroed by redaction)      |
 * | vehicleFilename    | cstr 32 | standings vehicleFilename                                        |
 * | fuelFraction   | u8      | standings fuelFraction x 255 exactly (value / 255 equals REST to the last digit, correlation 1.0000, 4,255 vehicle/frame pairs; found by searching every u8, f32 and f64 in the row) |
 *
 * The player's lap timing reads three of these (`timeIntoLap`, `lastLapTime`, `bestLapTime`) from
 * the player's scoring row; no new offsets were needed. The scoring `flag` and `underYellow`
 * bytes also give every car's flags (blue = 6; the other flags have no observed trigger).
 *
 * The scoring `fuelFraction` follows fuel, not virtual energy: in the Ferrari 499P recording it
 * differs from `veFraction` (e.g. 0.33 fuel against 0.33..1.00 energy, mostly different), and for
 * the player it stays within one count of fuelLitres / tankCapacityLitres in the telemetry row.
 * (The telemetry row's own fuel for the other cars drifts by about 0.012 from the REST value, so
 * the scoring byte is the source for all cars.)
 */
export const VEHICLE = {
  slotId: 0,
  driverName: { offset: 4, length: 32 },
  vehicleName: { offset: 36, length: 64 },
  lapsCompleted: 100,
  sector: 102,
  finishStatus: 103,
  lapDistance: 104,
  pathLateral: 112,
  trackEdge: 120,
  bestSectorTime1: 128,
  bestSectorTime2: 136,
  bestLapTime: 144,
  lastSectorTime1: 152,
  lastSectorTime2: 160,
  lastLapTime: 168,
  pitstops: 192,
  penalties: 194,
  player: 196,
  inControl: 197,
  pitting: 198,
  position: 199,
  carClass: { offset: 200, length: 32 },
  timeBehindNext: 232,
  timeBehindLeader: 244,
  lapStartTime: 256,
  /** f64 x3 world position in metres (the table's "pos"); y is up, the ground plane is x/z. */
  worldPos: 264,
  carVelocity: 288,
  /** f64 x9, row-major 3x3; world = matrix * local, the nose is local -z. */
  orientation: 336,
  pitState: 457,
  qualification: 460,
  timeIntoLap: 464,
  estimatedLapTime: 472,
  flag: 504,
  underYellow: 505,
  inGarageStall: 507,
  steamID: 536,
  vehicleFilename: { offset: 544, length: 32 },
  fuelFraction: 578,
} as const;

/**
 * Searched and not provable (so decoded as null): an ABS-active byte. Nothing in the telemetry
 * row was found that pulses only under heavy braking and never at throttle, so
 * `player.absActive` stays null. Per-car track surface (off track, approaching pits) has no
 * evidence either; only the player's own surface is derived from the in-car byte, the real-time
 * byte and the garage-stall byte.
 */

/** Telemetry block: three count bytes, then the rows. */
export const TELEMETRY_BASE = RESULTS_STREAM.offset + RESULTS_STREAM.length;
export const TELEMETRY = {
  /** u8. 37 in the recording, equal to numberOfVehicles. */
  carsWithTelemetry: 0,
  /** u8. Row index of the player (36 in the recording, while the player's id is 0). */
  playerRowIndex: 1,
  /** u8 bool. */
  playerInCar: 2,
  rowsOffset: 4,
  rowStride: 1888,
} as const;

/**
 * One telemetry row (offsets relative to the row).
 *
 * | field         | type    | evidence                                                           |
 * | ------------- | ------- | ------------------------------------------------------------------ |
 * | slotId            | i32     | equals the scoring slotId (0 for the player, which sits in row 36) |
 * | sessionTime   | f64     | tracks currentEventTime of the scoring block within one tick              |
 * | vehicleName   | cstr 64 | same text as the scoring vehicleName                               |
 * | velocity      | f64 x3  | scoring carVelocity to 3 digits; z is about -(speed) when moving      |
 * | gear          | i32     | 5 at 57 m/s in a 7 speed car; 0 in the pits (LOCAL); steering > 0 pairs with lateral accel toward the right (LOCAL) |
 * | engineRpm           | f64     | 5722 rpm at 57 m/s in 5th, below rpmLimit 8500                 |
 * | *Input       | f64     | unfiltered pedals 0..1 and steering -1..1; brake 0.68 while the   |
 * |               |         | car decelerates (the filtered copies follow 32 bytes later)        |
 * | fuelLitres          | f64     | litres; fuelLitres / tankCapacityLitres equals standings fuelFraction (0.7843) |
 * | tankCapacityLitres  | f64     | 110 litres, the Hypercar tank                                      |
 * | pitLimiterOn  | u8      | 0 on track; 1 in the pit lane (LOCAL)                              |
 * | veFraction     | f32     | 0..1; tracks standings veFraction (0.9831 vs 0.9823 a tick later)  |
 * | rearBrakeBias | f64     | rear share of the brake force, 0..1. REST getPlayerGarageData VM_BRAKE_BALANCE stringValue "51.0:49.0" (front:rear) equals 1 - this value on 115 of 115 paired frames; over the recording the value moves between 0.4475 and 0.49, so it includes the live brake migration |
 * | frontCompound | cstr 18 | "Medium" until 155 s, then "Soft": REST getPlayerGarageData VM_FRONT_TIRE_COMPOUND (and every WM_COMPOUND-W_xx) says "Soft" from 155 s on, so the text follows the fitted set |
 * | rearCompound  | cstr 18 | same as the front in the recording; REST VM_REAR_TIRE_COMPOUND "Soft"   |
 * | frontCompoundIndex | u8 | the fitted front compound's place in the car's compound list: 1 then 0 in the same buffer as the text goes from "Medium" to "Soft" (150.2 s into the recording); over all 37 cars of every buffer one class reads Soft 0, Medium 1, Hard 2 and the other Medium 0, so it is a list position, not a kind |
 * | rearCompoundIndex  | u8 | the same for the rear; equal to the front on every car in the recordings |
 */
export const TELEM = {
  slotId: 0,
  sessionTime: 12,
  vehicleName: { offset: 32, length: 64 },
  velocity: 184,
  gear: 352,
  engineRpm: 356,
  throttleInput: 388,
  brakeInput: 396,
  steeringInput: 404,
  clutchInput: 412,
  fuelLitres: 524,
  rpmLimit: 532,
  pitLimiterOn: 604,
  tankCapacityLitres: 608,
  veFraction: 776,
  rearBrakeBias: 664,
  frontCompound: { offset: 620, length: 18 },
  rearCompound: { offset: 638, length: 18 },
  frontCompoundIndex: 606,
  rearCompoundIndex: 607,
  tyresOffset: 848,
  tyreStride: 260,
} as const;

/** Wheel order in the telemetry row: front left, front right, rear left, rear right. */
export const TYRE_COUNT = 4;

/**
 * One wheel (offsets relative to the wheel).
 *
 * | field      | type   | evidence                                                              |
 * | ---------- | ------ | --------------------------------------------------------------------- |
 * | brakeTempK | f64    | Kelvin (LOCAL): exactly 293.15 (20 C) on the cold car at the start, equal to the carcass and inner-layer values (301.15) in the garage, then 620..626 K at the front and 547 K at the rear under 0.74 brake, cooling down a straight; fronts run hotter than rears throughout |
 * | pressureKpa   | f64    | kPa, 134 front and rear within 5 kPa of each other                    |
 * | surfaceTempK      | f64 x3 | Kelvin, 325..331 after a lap; left, middle, right across the tread    |
 * | treadRemaining       | f64    | 0.9955 on a nearly new set and falling with distance: 1 = new; REST WM_COMPOUND-W_FL "83% Soft" while this reads 0.84 (LOCAL) |
 * | carcassTempK  | f64    | Kelvin (LOCAL): one value per tyre; follows the surface temperatures slowly (no spikes under braking), 301.15 in the garage like the brakes |
 * | innerLayerTempK | f64 x3 | Kelvin (LOCAL): left, middle, right like the surface; the same edge-to-edge pattern as the surface (e.g. 319.6 / 324.9 / 324.5 against 322.7 / 328.8 / 328.5 on the front left) without the braking spikes |
 *
 * | compoundIndex  | u8 | the compound on this wheel, as a place in the car's compound list like the row's frontCompoundIndex: equal to its axle's index on every wheel of all 37 cars in every buffer of the four LMU recordings (values 0, 1 and 2), and 1 then 0 on all four wheels in the buffer where the player's set went from Medium to Soft |
 * | compoundKind   | u8 | the kind of that compound: 0 on Soft, 1 on Medium, 2 on Hard in both classes of the recording (Medium reads 1 also where its list position is 0); other values (wet) were not observed |
 *
 * Every set in the recordings is one compound on all four wheels, so a wheel that differs from its
 * axle was not observed; the per-wheel bytes are read because the sim lets each wheel take its own
 * compound (REST getPlayerGarageData has WM_COMPOUND-W_FL/FR/RL/RR next to the axle settings).
 *
 * The 16 bytes at 160 hold the surface name under the tyre ("ROAD", "RACEOLD"); not decoded.
 */
export const WHEEL = {
  brakeTempK: 24,
  pressureKpa: 120,
  surfaceTempK: 128,
  treadRemaining: 152,
  carcassTempK: 204,
  innerLayerTempK: 212,
  compoundIndex: 240,
  compoundKind: 241,
} as const;

/** Names for the `compoundKind` values seen in the recordings; other values give no name. */
export const COMPOUND_KIND_NAMES: readonly string[] = ["Soft", "Medium", "Hard"];
