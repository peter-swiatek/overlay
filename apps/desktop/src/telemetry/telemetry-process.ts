/**
 * Entry point of the telemetry utility process. It reads the sims' shared memory (read-only),
 * derives fuel and gap values and streams frames to overlay renderers over MessagePorts.
 *
 * Capture coexistence: the capture process also holds read-only views of the same mappings, and
 * both may wait on IRSDKDataValidEvent. See IracingLiveSource for the auto-reset risk.
 */
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { BUILD_INFO } from "../shared/build-info";
import type { TelemetryCommand } from "../shared/telemetry-types";
import { createWindowsSharedMemorySource } from "../capture/shm-windows";
import { systemClock } from "../capture/shm";
import type { LiveSource } from "./source";
import { IracingLiveSource } from "./iracing-live";
import { LmuLiveSource } from "./lmu-live";
import { MockTelemetrySource } from "./mock";
import type { PortLike } from "./publisher";
import { ReplayTelemetrySource } from "./replay";
import { TelemetryService } from "./service";
import { WorkerSessionParser, type WorkerLike } from "./session-parser";

const parentPort = process.parentPort;

function spawnSessionWorker(): WorkerLike {
  // A plain path (not `new URL`), so the bundler leaves it alone; the worker is its own build
  // entry and lands next to this file.
  return new Worker(join(import.meta.dirname, "telemetry-session-worker.js"));
}

async function main(): Promise<void> {
  console.info(`[overlay-telemetry] version ${BUILD_INFO.displayVersion}`);
  // Messages that arrive while the shared-memory module loads are replayed once the service exists.
  const early: { command: TelemetryCommand; ports: PortLike[] }[] = [];
  const ready: { service?: TelemetryService } = {};
  parentPort.on("message", (event) => {
    const message = {
      command: event.data as TelemetryCommand,
      ports: event.ports as unknown as PortLike[],
    };
    if (ready.service) ready.service.handle(message.command, message.ports);
    else early.push(message);
  });

  // Undefined off Windows: the live sims then never go live and the process only serves
  // replay and mock sources.
  const shm = await createWindowsSharedMemorySource().catch(() => undefined);
  const live: Partial<Record<"iracing" | "lmu", LiveSource>> = {};
  if (shm) {
    live.iracing = new IracingLiveSource(
      shm,
      systemClock,
      new WorkerSessionParser(spawnSessionWorker),
    );
    live.lmu = new LmuLiveSource(shm, systemClock);
  }

  const service = new TelemetryService({
    live,
    createReplay: (path, speed, loop) => ReplayTelemetrySource.fromFile(path, { speed, loop }),
    createMock: () => new MockTelemetrySource(),
    monoMs: () => systemClock.monoMs(),
    sendToMain: (event) => parentPort.postMessage(event),
    onStopped: () => process.exit(0),
  });
  ready.service = service;
  service.start();
  for (const m of early) service.handle(m.command, m.ports);
}

void main();
