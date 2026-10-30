import { createReadStream } from "node:fs";
import { describe, expect, it } from "vitest";
import { RecordKind } from "../../fixtures/format";
import { FixtureReader } from "../../fixtures/reader";
import { isSimState } from "../../model";
import { LmuDecoder } from "./decoder";
import { SCORING_BASE, SESSION } from "./layout";

// Local only: point OVERLAY_LMU_RECORDING at a copy of the 39 minute Le Mans recording.
const path = process.env["OVERLAY_LMU_RECORDING"];

describe("full LMU recording", () => {
  it.skipIf(!path)(
    "decodes every on-track frame",
    async () => {
      const reader = new FixtureReader(createReadStream(path as string));
      const decoder = new LmuDecoder();
      let onTrack = 0;
      let onTrackFailures = 0;
      let other = 0;
      let otherFailures = 0;
      const firstErrors = new Set<string>();
      let lastEt = -Infinity;
      let etBackwards = 0;
      for await (const record of reader.records()) {
        if (record.kind === RecordKind.RestResponse) {
          decoder.observeRest(JSON.parse(record.payload.toString("utf8")));
          continue;
        }
        if (record.kind !== RecordKind.LmuBuffer) continue;
        const b = record.payload;
        const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
        // On track: the game is in real time and the session is running.
        const live =
          v.getUint8(SCORING_BASE + SESSION.inRealtime) === 1 &&
          v.getUint8(SCORING_BASE + SESSION.gamePhase) === 5;
        const result = decoder.decode(b);
        const ok = result.error === null && isSimState(result.state) && result.state.connected;
        if (!ok && firstErrors.size < 5) firstErrors.add(String(result.error));
        if (live) {
          onTrack++;
          if (!ok) onTrackFailures++;
          const et = result.state.tickTimeS ?? lastEt;
          if (et < lastEt) etBackwards++;
          lastEt = et;
        } else {
          other++;
          if (!ok) otherFailures++;
        }
      }
      console.info(
        `LMU recording: ${onTrack} on-track frames, ${onTrackFailures} failures; ` +
          `${other} other frames, ${otherFailures} failures; errors: ${[...firstErrors].join(" | ")}`,
      );
      expect(onTrack).toBeGreaterThan(1000);
      expect(onTrackFailures).toBe(0);
      expect(etBackwards).toBe(0);
    },
    600_000,
  );
});
