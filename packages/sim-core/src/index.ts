export * from "./fixtures";
export * from "./model";
export * from "./recording";
export * from "./replay";
export * from "./telemetry";
export * from "./calc/fuel";
export * from "./calc/gaps";
export * as iracing from "./adapters/iracing";
export * as lmu from "./adapters/lmu";

export function simCoreName(): string {
  return "@overlay/sim-core";
}
