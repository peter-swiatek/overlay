import { describe, expect, it } from "vitest";
import {
  LMU_MAPPING_BYTES,
  PATHS,
  RESULTS_STREAM,
  SCORING_BASE,
  SESSION,
  VEHICLE,
  VEHICLE_ROWS_OFFSET,
  VEHICLE_STRIDE,
} from "../adapters/lmu/layout";
import { LmuRedactor, redactIracingYaml, redactLmuBufferByOffset } from "./redact";

describe("redactIracingYaml", () => {
  it("keeps line endings and unrelated lines", () => {
    const yaml = 'Drivers:\r\n - CarIdx: 3\r\n   UserName: Jane Doe\r\n   CarNumber: "9"\r\n';
    const out = redactIracingYaml(yaml);
    expect(out).toBe('Drivers:\r\n - CarIdx: 3\r\n   UserName: Driver 3\r\n   CarNumber: "9"\r\n');
  });

  it("leaves team id 0 alone and makes other ids synthetic", () => {
    const yaml = " - CarIdx: 2\n   UserID: 999999\n   TeamID: 0\n - CarIdx: 6\n   TeamID: 31\n";
    const out = redactIracingYaml(yaml);
    expect(out).toContain("UserID: 900002");
    expect(out).toContain("TeamID: 0");
    expect(out).toContain("TeamID: 800006");
  });
});

describe("LmuRedactor", () => {
  it("replaces abbreviated driver names such as the pit menu shows", () => {
    const redactor = new LmuRedactor();
    redactor.observe({
      path: "/rest/watch/standings",
      body: [{ slotID: 7, driverName: "Jane Doe", fullTeamName: "Team Fast" }],
    });
    const payload = Buffer.from(
      JSON.stringify({ path: "/p", body: { text: "J Doe", other: "Jane Doe" } }),
    );
    const out = redactor.redactRestPayload(payload).toString("utf8");
    expect(out).not.toContain("Doe");
    expect(out).toContain("Driver 7");
  });

  it("never grows a name inside a fixed-size buffer", () => {
    const redactor = new LmuRedactor();
    redactor.observe({
      path: "/rest/watch/standings",
      body: [{ slotID: 12, driverName: "Abcdef", fullTeamName: "" }],
    });
    const buffer = Buffer.alloc(32);
    buffer.write("Abcdef", 4);
    const out = redactor.redactBuffer(buffer);
    expect(out.length).toBe(32);
    expect(out.includes("Abcdef")).toBe(false);
    expect(out.subarray(4, 10).toString("latin1")).toBe("D12\0\0\0");
  });
});

describe("redactLmuBufferByOffset", () => {
  function sample(): Buffer {
    const buffer = Buffer.alloc(LMU_MAPPING_BYTES);
    buffer.writeInt32LE(2, SCORING_BASE + SESSION.numVehicles);
    buffer.write("Real Player", SCORING_BASE + SESSION.playerName.offset);
    buffer.write("Profile Name", SCORING_BASE + SESSION.playerFileName.offset);
    buffer.write("C:\\Users\\someone\\LMU", PATHS.offset);
    buffer.write("<Score>Jane Doe</Score>", RESULTS_STREAM.offset);
    const rows = [
      { id: 7, name: "Jane Doe", player: 0 },
      { id: 0, name: "Real Player", player: 1 },
    ];
    rows.forEach((row, i) => {
      const o = VEHICLE_ROWS_OFFSET + i * VEHICLE_STRIDE;
      buffer.writeInt32LE(row.id, o);
      buffer.write(row.name, o + VEHICLE.driverName.offset);
      buffer.writeUInt8(row.player, o + VEHICLE.isPlayer);
      buffer.writeBigUInt64LE(76561198000000000n, o + VEHICLE.steamId);
    });
    return buffer;
  }

  it("rewrites names, paths, ids and the results stream without changing the size", () => {
    const input = sample();
    const out = redactLmuBufferByOffset(input);
    expect(out.length).toBe(input.length);
    const text = out.toString("latin1");
    for (const secret of ["Jane", "Real Player", "Profile", "someone", "Score"]) {
      expect(text.includes(secret)).toBe(false);
    }
    const second = VEHICLE_ROWS_OFFSET + VEHICLE_STRIDE;
    expect(out.toString("latin1", VEHICLE_ROWS_OFFSET + 4, VEHICLE_ROWS_OFFSET + 12)).toBe(
      "Driver 7",
    );
    expect(out.toString("latin1", second + 4, second + 12)).toBe("Driver 0");
    expect(out.readBigUInt64LE(second + VEHICLE.steamId)).toBe(0n);
    expect(input.toString("latin1").includes("Jane Doe")).toBe(true);
  });

  it("leaves short buffers alone", () => {
    const short = Buffer.from("not an LMU mapping");
    expect(redactLmuBufferByOffset(short)).toBe(short);
  });
});
