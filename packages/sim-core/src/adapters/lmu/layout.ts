/**
 * Byte offsets of the `LMU_Data` shared-memory mapping, as observed in recorded buffers
 * (game build 14200). All multi-byte values are little-endian, all structs are 4-byte packed
 * (so an f64 can start at any multiple of 4).
 *
 * Provenance: this table is our own. Every offset below was found by reading the committed
 * fixture slices and Peter's 39 minute Le Mans recording, and by cross-checking against the
 * `/rest/watch/standings` and `/rest/watch/sessionInfo` bodies recorded next to the buffers.
 * Field order was sanity-checked against the MIT-licensed ports named in docs/research/lmu.md;
 * no code, identifiers or comments were taken from them or from any proprietary header.
 *
 * The mapping is 327,680 bytes; the sim writes the first 324,820 and the rest stays zero.
 *
 *   0       header      events u32[16], game version, force-feedback torque, app window state
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
  gameVersion: 64,
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
 * | session          | i32     | 1 while REST session = PRACTICE1 (see {@link sessionTypeOf})|
 * | currentEt        | f64     | REST currentEventTime, same ET +- one 5 Hz tick             |
 * | endEt            | f64     | 3605 = REST maxTime 3600 + 5 s start offset; endEt - ET equals REST timeRemainingInGamePhase |
 * | maxLaps          | i32     | 0x7fffffff while REST maximumLaps is 4294967295 (timed)     |
 * | lapDist          | f64     | REST lapDistance 13623.9677734375, bit-exact                |
 * | numVehicles      | i32     | REST numberOfVehicles 37, standings length 37               |
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
 * | avgPathWetness   | f64     | REST averagePathWetness 0 (dry in the whole recording)      |
 * | serverName       | cstr 32 | REST serverName "-none-"                                    |
 */
export const SESSION = {
  trackName: { offset: 0, length: 64 },
  session: 64,
  currentEt: 68,
  endEt: 76,
  maxLaps: 84,
  lapDist: 88,
  numVehicles: 104,
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
  avgPathWetness: 332,
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
 * | id             | i32     | standings slotID                                                 |
 * | driverName     | cstr 32 | standings driverName                                             |
 * | vehicleName    | cstr 64 | standings vehicleName (team, season, number, livery tag)         |
 * | totalLaps      | i16     | standings lapsCompleted                                          |
 * | sector         | i8      | standings sector: 1 SECTOR1, 2 SECTOR2, 0 SECTOR3               |
 * | finishStatus   | i8      | standings finishStatus: 0 FSTAT_NONE (1 finished, 2 dnf, 3 dq)   |
 * | lapDist        | f64     | standings lapDistance, within the 1 s between a buffer and REST  |
 * | pathLateral    | f64     | standings pathLateral                                            |
 * | trackEdge      | f64     | standings trackEdge                                              |
 * | bestSector1/2  | f64     | standings bestSectorTime1/2 (-1 until set)                       |
 * | bestLapTime    | f64     | standings bestLapTime (-1 until set)                             |
 * | lastLapTime    | f64     | standings lastLapTime (0 until set)                              |
 * | numPitstops    | i16     | standings pitstops                                               |
 * | numPenalties   | i16     | standings penalties                                              |
 * | isPlayer       | u8      | standings player                                                 |
 * | control        | i8      | standings inControl (-1 none, 0 local player, 1 AI, 2 remote)    |
 * | inPits         | u8      | standings pitting                                                |
 * | place          | u8      | standings position                                               |
 * | vehicleClass   | cstr 32 | standings carClass                                               |
 * | timeBehindNext | f64     | standings timeBehindNext                                         |
 * | timeBehindLeader | f64   | standings timeBehindLeader                                       |
 * | lapStartEt     | f64     | standings lapStartET                                             |
 * | pos            | f64 x3  | standings carPosition x, y, z                                    |
 * | localVel       | f64 x3  | standings carVelocity x, y, z                                    |
 * | pitState       | u8      | standings pitState: 0 NONE, 5 EXITING (1-4 not observed: no stop) |
 * | qualification  | i32     | standings qualification                                         |
 * | timeIntoLap    | f64     | standings timeIntoLap                                            |
 * | estLapTime     | f64     | standings estimatedLapTime                                       |
 * | flag           | u8      | standings flag (GREEN = 0; blue = 6 is LOCAL)                    |
 * | underYellow    | u8      | standings underYellow                                            |
 * | inGarageStall  | u8      | standings inGarageStall                                          |
 * | steamId        | u64     | standings steamID (0 in the recording; zeroed by redaction)      |
 * | vehicleFile    | cstr 32 | standings vehicleFilename                                        |
 */
export const VEHICLE = {
  id: 0,
  driverName: { offset: 4, length: 32 },
  vehicleName: { offset: 36, length: 64 },
  totalLaps: 100,
  sector: 102,
  finishStatus: 103,
  lapDist: 104,
  pathLateral: 112,
  trackEdge: 120,
  bestSector1: 128,
  bestSector2: 136,
  bestLapTime: 144,
  lastSector1: 152,
  lastSector2: 160,
  lastLapTime: 168,
  numPitstops: 192,
  numPenalties: 194,
  isPlayer: 196,
  control: 197,
  inPits: 198,
  place: 199,
  vehicleClass: { offset: 200, length: 32 },
  timeBehindNext: 232,
  timeBehindLeader: 244,
  lapStartEt: 256,
  localVel: 288,
  pitState: 457,
  qualification: 460,
  timeIntoLap: 464,
  estLapTime: 472,
  flag: 504,
  underYellow: 505,
  inGarageStall: 507,
  steamId: 536,
  vehicleFile: { offset: 544, length: 32 },
} as const;

/** Telemetry block: three count bytes, then the rows. */
export const TELEMETRY_BASE = RESULTS_STREAM.offset + RESULTS_STREAM.length;
export const TELEMETRY = {
  /** u8. 37 in the recording, equal to numVehicles. */
  activeVehicles: 0,
  /** u8. Row index of the player (36 in the recording, while the player's id is 0). */
  playerVehicleIdx: 1,
  /** u8 bool. */
  playerHasVehicle: 2,
  rowsOffset: 4,
  rowStride: 1888,
} as const;

/**
 * One telemetry row (offsets relative to the row).
 *
 * | field         | type    | evidence                                                           |
 * | ------------- | ------- | ------------------------------------------------------------------ |
 * | id            | i32     | equals the scoring row id (0 for the player, which sits in row 36) |
 * | elapsedTime   | f64     | tracks currentEt of the scoring block within one tick              |
 * | vehicleName   | cstr 64 | same text as the scoring vehicleName                               |
 * | localVel      | f64 x3  | scoring localVel to 3 digits; z is about -(speed) when moving      |
 * | gear          | i32     | 5 at 57 m/s in a 7 speed car; 0 in the pits (LOCAL); steering > 0 pairs with lateral accel toward the right (LOCAL) |
 * | rpm           | f64     | 5722 rpm at 57 m/s in 5th, below engineMaxRpm 8500                 |
 * | throttle...   | f64     | unfiltered pedals 0..1 and steering -1..1; brake 0.68 while the   |
 * |               |         | car decelerates (the filtered copies follow 32 bytes later)        |
 * | fuel          | f64     | litres; fuel / fuelCapacity equals standings fuelFraction (0.7843) |
 * | fuelCapacity  | f64     | 110 litres, the Hypercar tank                                      |
 * | speedLimiter  | u8      | 0 on track; 1 in the pit lane (LOCAL)                              |
 * | virtualEnergy | f32     | 0..1; tracks standings veFraction (0.9831 vs 0.9823 a tick later)  |
 */
export const TELEM = {
  id: 0,
  elapsedTime: 12,
  vehicleName: { offset: 32, length: 64 },
  localVel: 184,
  gear: 352,
  rpm: 356,
  throttle: 388,
  brake: 396,
  steering: 404,
  clutch: 412,
  fuel: 524,
  engineMaxRpm: 532,
  speedLimiter: 604,
  fuelCapacity: 608,
  virtualEnergy: 776,
  wheelsOffset: 848,
  wheelStride: 260,
} as const;

/** Wheel order in the telemetry row: front left, front right, rear left, rear right. */
export const WHEEL_COUNT = 4;

/**
 * One wheel (offsets relative to the wheel).
 *
 * | field      | type   | evidence                                                              |
 * | ---------- | ------ | --------------------------------------------------------------------- |
 * | brakeTemp  | f64    | degrees Celsius, 565 on the braking player (not decoded)              |
 * | pressure   | f64    | kPa, 134 front and rear within 5 kPa of each other                    |
 * | temps      | f64 x3 | Kelvin, 325..331 after a lap; left, middle, right across the tread    |
 * | wear       | f64    | 0.9955 on a nearly new set and falling with distance: 1 = new         |
 */
export const WHEEL = {
  pressure: 120,
  temps: 128,
  wear: 152,
} as const;
