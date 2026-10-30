import { describe, expect, it } from "vitest";
import { LmuRedactor, redactIracingYaml } from "./redact";

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
