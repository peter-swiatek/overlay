/** Worker thread entry: parses session YAML for the telemetry process. */
import { parentPort } from "node:worker_threads";
import { runSessionJob, type SessionJob } from "./session-parser";

parentPort?.on("message", (job: SessionJob) => {
  parentPort?.postMessage(runSessionJob(job));
});
