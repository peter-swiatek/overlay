/**
 * Entry point of the capture utility process. It owns every handle on the sims' shared memory,
 * so a stall here can never block the main process or the overlay renderers.
 * Read-only towards the games: shared memory is opened with FILE_MAP_READ, REST is GET only.
 */
import type { CaptureCommand, CaptureEvent } from "../shared/capture-types";
import { IDLE_CAPTURE_STATUS } from "../shared/capture-types";
import { CaptureController } from "./controller";
import { createFixtureFileFactory } from "./file-sink";
import { IracingCapture } from "./iracing";
import { LmuCapture } from "./lmu";
import { LmuRestClient } from "./rest-client";
import { systemClock } from "./shm";
import { createWindowsSharedMemorySource } from "./shm-windows";

const port = process.parentPort;
const STATUS_INTERVAL_MS = 1000;

let controller: CaptureController | undefined;
let lmu: LmuCapture | undefined;
let statusTimer: NodeJS.Timeout | undefined;
let startError: string | undefined;

function send(event: CaptureEvent): void {
  port.postMessage(event);
}

function currentStatus() {
  const status = controller?.status() ?? { ...IDLE_CAPTURE_STATUS };
  return startError ? { ...status, error: startError } : status;
}

function startLoop(): void {
  const running = controller;
  if (!running) return;
  void running.runLoop().then(() => {
    // The loop also ends when a write failed (the controller stopped itself): stop reporting.
    if (!running.isRecording && statusTimer) {
      clearInterval(statusTimer);
      statusTimer = undefined;
      send({ type: "status", status: currentStatus() });
    }
  });
}

async function onStart(command: Extract<CaptureCommand, { type: "start" }>): Promise<void> {
  startError = undefined;
  if (controller?.isRecording) return;
  const source = await createWindowsSharedMemorySource().catch((error: unknown) => {
    startError = `Could not load Windows shared memory access: ${String(error)}`;
    return undefined;
  });
  if (!source) {
    startError ??= "Fixture capture needs Windows.";
    send({ type: "status", status: currentStatus() });
    return;
  }
  lmu = new LmuCapture(source, new LmuRestClient(systemClock), systemClock);
  lmu.hz = command.settings.lmuFrameHz;
  controller = new CaptureController({
    clock: systemClock,
    caps: [new IracingCapture(source, systemClock), lmu],
    files: createFixtureFileFactory(command.dir, systemClock),
    appVersion: command.appVersion,
    os: command.os,
  });
  controller.start();
  statusTimer ??= setInterval(
    () => send({ type: "status", status: currentStatus() }),
    STATUS_INTERVAL_MS,
  );
  startLoop();
}

port.on("message", (message) => {
  const command = message.data as CaptureCommand;
  switch (command.type) {
    case "start":
      void onStart(command);
      break;
    case "stop":
      void (async () => {
        await controller?.requestStop();
        if (statusTimer) clearInterval(statusTimer);
        statusTimer = undefined;
        send({ type: "stopped", status: currentStatus() });
      })();
      break;
    case "marker":
      void controller?.marker(command.label);
      break;
    case "settings":
      if (lmu) lmu.hz = command.settings.lmuFrameHz;
      break;
  }
});
