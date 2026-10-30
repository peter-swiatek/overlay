import { useEffect, useRef, useState } from "react";
import type { TelemetryFrame } from "@overlay/sim-core/types";
import { TelemetryClient, type ClientPort, type Selector } from "./client";

let shared: TelemetryClient | undefined;

/** The window's single client; created on first use (which also starts listening for the port). */
function getClient(): TelemetryClient {
  shared ??= new TelemetryClient({
    self: window,
    listen: (handler) => {
      const listener = (event: MessageEvent): void =>
        handler({
          source: event.source,
          data: event.data,
          ports: event.ports as unknown as readonly ClientPort[],
        });
      window.addEventListener("message", listener);
      return () => window.removeEventListener("message", listener);
    },
    requestSubscribe: (rateHz) => window.overlayApi.subscribeTelemetry(rateHz),
    nowMs: () => performance.now(),
  });
  return shared;
}

/**
 * Follows the telemetry stream. `selector` gets the newest frame (null before the first one)
 * and must check `frame.status` before it reads `frame.state`. The component re-renders at most
 * `rateHz` times a second, and only when the selected value changed.
 */
export function useTelemetry<T>(selector: Selector<T>, rateHz: number): T {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const [value, setValue] = useState<T>(() => selector(getClient().latest()));

  useEffect(
    () =>
      getClient().select(
        (frame: TelemetryFrame | null) => selectorRef.current(frame),
        rateHz,
        setValue,
      ),
    [rateHz],
  );
  return value;
}
