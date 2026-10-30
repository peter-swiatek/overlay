import { readJsonFile, writeJsonFileAtomic } from "./json-file";
import { parseLayout, type Layout } from "./layout";

/** Persists overlay positions and sizes to a JSON file. */
export class LayoutStore {
  constructor(private readonly file: string) {}

  load(): Layout {
    return parseLayout(readJsonFile(this.file));
  }

  save(layout: Layout): void {
    writeJsonFileAtomic(this.file, layout);
  }
}
