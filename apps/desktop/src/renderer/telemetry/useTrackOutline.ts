import { useEffect, useState } from "react";
import type { TrackMapData } from "@overlay/overlays";
import { getClient } from "./useTelemetry";

/** The outline can be replaced by a better one while driving, so it is fetched again this often. */
export const OUTLINE_REFRESH_MS = 30_000;

/**
 * Fetches the outline (and corner list) of `trackKey` from the telemetry process once `ready`,
 * and again every OUTLINE_REFRESH_MS. Null before the first answer, without an outline, or for
 * a moment after the track changes.
 */
export function useTrackOutline(trackKey: string | null, ready: boolean): TrackMapData | null {
  const [held, setHeld] = useState<{ key: string; data: TrackMapData | null } | null>(null);

  useEffect(() => {
    if (trackKey === null || !ready) return;
    let live = true;
    const fetchOutline = (): void => {
      void getClient()
        .requestTrackOutline(trackKey)
        .then((reply) => {
          // A timeout keeps what we have; an answer replaces it.
          if (!live || reply === null) return;
          const data =
            reply.outline === null
              ? null
              : { outline: reply.outline, corners: reply.corners ?? [] };
          setHeld({ key: trackKey, data });
        });
    };
    fetchOutline();
    const timer = setInterval(fetchOutline, OUTLINE_REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [trackKey, ready]);

  return ready && held !== null && held.key === trackKey ? held.data : null;
}
