import type { TelemetryCommand, TelemetryEvent } from "../shared/telemetry-types";
import { TelemetryEngine, type EngineDeps } from "./engine";
import { TelemetryPublisher, type PortLike } from "./publisher";

export interface ServiceDeps extends Omit<EngineDeps, "publish" | "onStatus"> {
  /** Reads the monotonic clock in milliseconds. */
  monoMs(): number;
  sendToMain(event: TelemetryEvent): void;
  /** Called after `stop`, once everything is closed; the process entry exits here. */
  onStopped(): void;
}

/** The logic of the telemetry process without Electron: commands in, frames and events out. */
export class TelemetryService {
  readonly publisher = new TelemetryPublisher();
  readonly engine: TelemetryEngine;

  constructor(private readonly deps: ServiceDeps) {
    this.engine = new TelemetryEngine({
      ...deps,
      publish: (frame) => this.publisher.publish(frame, deps.monoMs()),
      onStatus: (status, source, error) =>
        deps.sendToMain({ type: "status", status, source, error }),
    });
  }

  start(): void {
    this.engine.start();
  }

  /** `ports` are the MessagePorts that arrived with the message (`event.ports`). */
  handle(command: TelemetryCommand, ports: readonly PortLike[]): void {
    switch (command.type) {
      case "setSource":
        this.engine.setSource({
          source: command.source,
          replayPath: command.replayPath,
          replaySpeed: command.replaySpeed,
          replayLoop: command.replayLoop,
        });
        break;
      case "subscribe": {
        const port = ports[0];
        if (port) this.publisher.addSubscriber(port, command.rateHz);
        break;
      }
      case "stop":
        this.engine.stop();
        this.deps.onStopped();
        break;
    }
  }
}
