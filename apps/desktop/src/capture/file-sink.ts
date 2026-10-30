import { createWriteStream, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { FixtureWriter, fixtureFileName, type HeaderFields, type SimId } from "@overlay/sim-core";
import type { FixtureFileFactory, OpenFixtureFile } from "./controller";
import type { Clock } from "./shm";

/** Writes `<dir>/<sim>-<UTC timestamp>.ovfx`; never overwrites an existing file. */
export function createFixtureFileFactory(dir: string, clock: Clock): FixtureFileFactory {
  return {
    async open(sim: SimId, header: HeaderFields): Promise<OpenFixtureFile> {
      mkdirSync(dir, { recursive: true });
      const when = new Date(clock.wallMs());
      let path = "";
      let fd = -1;
      for (let attempt = 0; fd < 0; attempt++) {
        path = join(dir, fixtureFileName(sim, when, attempt));
        try {
          fd = openSync(path, "wx");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt > 100) throw error;
        }
      }
      const stream = createWriteStream(path, { fd, autoClose: true });
      const writer = new FixtureWriter(stream, header, { clock });
      return {
        path,
        sink: writer,
        sizeBytes: () => stream.bytesWritten,
        close: (summary) => writer.close(summary),
      };
    },
  };
}
