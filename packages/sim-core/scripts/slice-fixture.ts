/**
 * Cuts a time window out of a recording so it can be committed as a small, self-contained,
 * redacted test fixture.
 *
 *   pnpm --filter @overlay/sim-core slice <in.ovfx> <out.ovfx> --from <s> --to <s> [--no-redact]
 *
 * --from and --to are seconds after the first record of the input.
 */
import { createReadStream, createWriteStream } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { sliceFixture } from "../src/fixtures/slice";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    from: { type: "string" },
    to: { type: "string" },
    "no-redact": { type: "boolean", default: false },
  },
});

const [input, output] = positionals;
const fromS = Number(values.from);
const toS = Number(values.to);
if (!input || !output || !Number.isFinite(fromS) || !Number.isFinite(toS) || toS <= fromS) {
  console.error("usage: slice <in> <out> --from <s> --to <s> [--no-redact]");
  process.exit(2);
}

const sink = createWriteStream(output);
const finished = new Promise<void>((resolve, reject) => {
  sink.once("finish", resolve).once("error", reject);
});
const result = await sliceFixture({
  openInput: () => createReadStream(input),
  output: sink,
  fromS,
  toS,
  sourceName: basename(input),
  redact: !values["no-redact"],
});
await finished;
console.log(
  `${basename(output)}: ${result.sim}, ${result.framesKept} frames, ${result.recordsWritten} records` +
    `, frames ${result.firstFrameS?.toFixed(2)}s..${result.lastFrameS?.toFixed(2)}s`,
);
