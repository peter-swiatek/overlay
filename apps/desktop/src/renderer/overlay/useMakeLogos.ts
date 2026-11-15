import { useEffect, useState } from "react";

const NONE: Readonly<Record<string, string>> = {};

/** The user's own manufacturer logos from main (make id -> data URL); follows changes. */
export function useMakeLogos(): Readonly<Record<string, string>> {
  const [logos, setLogos] = useState<Readonly<Record<string, string>>>(NONE);
  useEffect(() => {
    let pushed = false;
    let cancelled = false;
    window.overlayApi.logos
      .get()
      .then((initial) => {
        if (!cancelled && !pushed) setLogos(initial);
      })
      .catch((err: unknown) => console.error("Could not load the logo overrides", err));
    const off = window.overlayApi.logos.onChanged((next) => {
      pushed = true;
      setLogos(next);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);
  return logos;
}
