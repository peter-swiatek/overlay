import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { RecordKind } from "../../fixtures/format";
import { FixtureReader } from "../../fixtures/reader";
import { IracingAdapter } from "./adapter";
import { IracingDecoder } from "./decoder";
import { SessionInfoCache, type IracingSessionInfo } from "./session-yaml";
import type { SimState } from "../../model/sim-state";

/** Test helper: replays an iRacing fixture through the adapter, one SimState per var buffer. */

export const FIXTURE_DIR = fileURLToPath(new URL("../../../../../fixtures/", import.meta.url));

export interface Tick {
  /** Seconds since the first record of the source recording (the slice's own clock). */
  timeS: number;
  tick: number;
  buffer: Uint8Array;
  info: IracingSessionInfo | null;
  /** Number of YAML records seen so far. */
  yamlCount: number;
}

export interface LoadedSlice {
  headerBytes: Uint8Array;
  decoder: IracingDecoder;
  ticks: Tick[];
  yamlTexts: string[];
}

export async function loadSlice(path: string): Promise<LoadedSlice> {
  const reader = new FixtureReader(createReadStream(path));
  const cache = new SessionInfoCache();
  const ticks: Tick[] = [];
  const yamlTexts: string[] = [];
  let headerBytes: Uint8Array | undefined;
  let decoder: IracingDecoder | undefined;
  let info: IracingSessionInfo | null = null;
  for await (const record of reader.records()) {
    if (record.kind === RecordKind.IracingHeader) {
      headerBytes = record.payload;
      decoder = IracingDecoder.fromHeaderBytes(record.payload);
    } else if (record.kind === RecordKind.IracingSessionYaml) {
      const text = record.payload.toString("latin1");
      yamlTexts.push(text);
      // Fixtures carry no update counter, so every YAML record counts as a new one.
      info = cache.update(yamlTexts.length, text);
    } else if (record.kind === RecordKind.IracingVarBuffer) {
      ticks.push({
        timeS: record.monoMs / 1000,
        tick: record.payload.readUInt32LE(0),
        buffer: record.payload.subarray(4),
        info,
        yamlCount: yamlTexts.length,
      });
    }
  }
  if (headerBytes === undefined || decoder === undefined) throw new Error("slice has no header");
  return { headerBytes, decoder, ticks, yamlTexts };
}

export function toStates(slice: LoadedSlice): SimState[] {
  const adapter = new IracingAdapter(slice.decoder);
  return slice.ticks.map((t) => adapter.toSimState(t.buffer, t.info));
}
