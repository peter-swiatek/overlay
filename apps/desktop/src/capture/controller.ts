import { RecordKind, type HeaderFields, type SimId } from "@overlay/sim-core";
import type { CaptureStatus } from "../shared/capture-types";
import type { RecordSink, SimCapture } from "./sim-capture";
import type { Clock } from "./shm";

export const DETECT_INTERVAL_MS = 2000;
export const ROTATE_AFTER_MS = 60 * 60 * 1000;
export const CAPTURE_TOOL_VERSION = "1";

export interface OpenFixtureFile {
  path: string;
  sink: RecordSink;
  /** Current compressed size on disk. */
  sizeBytes(): number;
  close(summary: Record<string, unknown>): Promise<void>;
}

export interface FixtureFileFactory {
  open(sim: SimId, header: HeaderFields): Promise<OpenFixtureFile>;
}

export interface ControllerOptions {
  clock: Clock;
  caps: SimCapture[];
  files: FixtureFileFactory;
  appVersion: string;
  os: string;
}

interface ActiveFile {
  cap: SimCapture;
  file: OpenFixtureFile;
  startedMono: number;
}

const SIMS: SimId[] = ["iracing", "lmu"];

/**
 * Drives the per-sim captures: detects which sim runs, owns the output file, rotates it when the
 * sim changes or after 60 minutes, and reports status. Everything time-related goes through the
 * injected clock, so tests drive it with a fake one by calling `tick`.
 */
export class CaptureController {
  private recording = false;
  private active: ActiveFile | undefined;
  private lastDetectMono = Number.NEGATIVE_INFINITY;
  private lastRateMono = 0;
  private lastRateFrames: Record<SimId, number> = { iracing: 0, lmu: 0 };
  private fps: Record<SimId, number> = { iracing: 0, lmu: 0 };
  private error: string | undefined;
  private filesWritten = 0;

  constructor(private readonly options: ControllerOptions) {}

  get isRecording(): boolean {
    return this.recording;
  }

  start(): void {
    this.recording = true;
    this.error = undefined;
    this.lastDetectMono = Number.NEGATIVE_INFINITY;
    this.lastRateMono = this.options.clock.monoMs();
  }

  async stop(): Promise<void> {
    this.recording = false;
    await this.closeActive("stopped");
    for (const cap of this.options.caps) cap.close();
  }

  /** Writes an event marker into the current file; returns false when no file is open. */
  async marker(label: string): Promise<boolean> {
    const active = this.active;
    if (!active) return false;
    try {
      await active.file.sink.write(RecordKind.Marker, {
        label,
        sim: active.cap.sim,
        wallUtc: new Date(this.options.clock.wallMs()).toISOString(),
      });
      active.cap.onMarker();
      return true;
    } catch (error) {
      await this.fail(error);
      return false;
    }
  }

  /** Milliseconds the driver loop may sleep before the next tick. */
  get suggestedDelayMs(): number {
    if (!this.active) return 100;
    return this.active.cap.sim === "iracing" ? 0 : 5;
  }

  async tick(): Promise<void> {
    if (!this.recording) return;
    try {
      const now = this.options.clock.monoMs();
      if (now - this.lastDetectMono >= DETECT_INTERVAL_MS) {
        this.lastDetectMono = now;
        for (const cap of this.options.caps) await cap.probe(this.active?.cap === cap);
      }
      await this.reconcile(now);
      if (this.active) await this.active.cap.step();
      this.updateRates(now);
    } catch (error) {
      await this.fail(error);
    }
  }

  status(): CaptureStatus {
    const live: Record<SimId, boolean> = { iracing: false, lmu: false };
    const frames: Record<SimId, number> = { iracing: 0, lmu: 0 };
    for (const cap of this.options.caps) {
      live[cap.sim] = cap.live;
      frames[cap.sim] = cap.frames;
    }
    return {
      recording: this.recording,
      sim: this.active?.cap.sim ?? null,
      file: this.active?.file.path ?? null,
      sizeBytes: this.active?.file.sizeBytes() ?? 0,
      filesWritten: this.filesWritten,
      live,
      fps: { ...this.fps },
      frames,
      error: this.error ?? null,
    };
  }

  private async reconcile(now: number): Promise<void> {
    const active = this.active;
    if (active) {
      const cap = active.cap;
      const other = this.options.caps.find((c) => c !== cap && c.live);
      if (!cap.live && other) {
        await this.closeActive("sim-changed");
        await this.openFor(other, now);
      } else if (now - active.startedMono >= ROTATE_AFTER_MS) {
        await this.closeActive("rotated");
        if (cap.live) await this.openFor(cap, now);
      } else if (!cap.live && !cap.isOpen) {
        await this.closeActive("sim-ended");
      }
      return;
    }
    const cap = this.options.caps.find((c) => c.live);
    if (cap) await this.openFor(cap, now);
  }

  private async openFor(cap: SimCapture, now: number): Promise<void> {
    const header: HeaderFields = {
      sim: cap.sim,
      captureToolVersion: CAPTURE_TOOL_VERSION,
      appVersion: this.options.appVersion,
      os: this.options.os,
      startedUtc: new Date(this.options.clock.wallMs()).toISOString(),
      notes: "",
      ...cap.headerExtras(),
    };
    const file = await this.options.files.open(cap.sim, header);
    this.active = { cap, file, startedMono: now };
    this.filesWritten++;
    await cap.beginFile(file.sink);
  }

  private async closeActive(reason: string): Promise<void> {
    const active = this.active;
    if (!active) return;
    this.active = undefined;
    const stats = await active.cap.endFile();
    await active.file.close({
      sim: active.cap.sim,
      reason,
      durationMs: this.options.clock.monoMs() - active.startedMono,
      closedUtc: new Date(this.options.clock.wallMs()).toISOString(),
      ...stats,
    });
  }

  private async fail(error: unknown): Promise<void> {
    this.error = error instanceof Error ? error.message : String(error);
    this.recording = false;
    try {
      await this.closeActive("error");
    } catch {
      // The file is already unusable; the error above is what the user needs to see.
    }
    for (const cap of this.options.caps) cap.close();
  }

  private updateRates(now: number): void {
    const dt = now - this.lastRateMono;
    if (dt < 1000) return;
    for (const sim of SIMS) {
      const cap = this.options.caps.find((c) => c.sim === sim);
      const frames = cap?.frames ?? 0;
      const delta = frames - this.lastRateFrames[sim];
      this.fps[sim] = this.active?.cap.sim === sim ? Math.max(delta, 0) / (dt / 1000) : 0;
      this.lastRateFrames[sim] = frames;
    }
    this.lastRateMono = now;
  }
}
