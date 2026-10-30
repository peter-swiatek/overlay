import { Deriver } from "@overlay/sim-core";
import type {
  TelemetryCommand,
  TelemetryEvent,
  TrackOutlineReply,
  TrackOutlineRequest,
} from "../shared/telemetry-types";
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
  readonly publisher: TelemetryPublisher;
  readonly engine: TelemetryEngine;
  private readonly deriver: Deriver;

  constructor(private readonly deps: ServiceDeps) {
    this.publisher = new TelemetryPublisher(deps.monoMs);
    // The service holds the Deriver too, to answer track outline requests.
    this.deriver = deps.deriver ?? new Deriver();
    this.engine = new TelemetryEngine({
      ...deps,
      deriver: this.deriver,
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
        if (port) {
          this.publisher.addSubscriber(port, command.rateHz, (data, reply) =>
            this.answer(data, reply),
          );
        }
        break;
      }
      case "stop":
        this.engine.stop();
        this.deps.onStopped();
        break;
    }
  }

  private answer(data: unknown, reply: (message: unknown) => void): void {
    const request = asTrackOutlineRequest(data);
    if (request === undefined) return;
    const answer: TrackOutlineReply = {
      type: "trackOutline",
      requestId: request.requestId,
      outline: this.deriver.trackOutline,
    };
    reply(answer);
  }
}

function asTrackOutlineRequest(data: unknown): TrackOutlineRequest | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const { type, requestId } = data as Partial<TrackOutlineRequest>;
  const validId = typeof requestId === "number" || typeof requestId === "string";
  return type === "getTrackOutline" && validId ? { type, requestId } : undefined;
}
