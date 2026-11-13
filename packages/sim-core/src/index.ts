export * from "./fixtures";
export * from "./model";
export * from "./recording";
export * from "./replay";
export * from "./telemetry";
export * from "./track";
export * from "./calc/fuel";
export * from "./calc/gaps";
export * from "./calc/standings";
export * from "./calc/proximity";
export * from "./calc/delta";
export * from "./calc/slow-car";
export * from "./calc/laps";
export * from "./calc/tyres";
export * from "./calc/incidents";
export * as iracing from "./adapters/iracing";
export * as lmu from "./adapters/lmu";

export function simCoreName(): string {
  return "@overlay/sim-core";
}
export * from "./sim-text";
