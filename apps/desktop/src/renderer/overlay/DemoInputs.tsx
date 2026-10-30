import { useEffect, useRef } from "react";

/** Fake throttle/brake bars driven by requestAnimationFrame (about 60 Hz). Updates the DOM directly. */
export function DemoInputs() {
  const throttle = useRef<HTMLDivElement>(null);
  const brake = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    const tick = (now: number): void => {
      const t = now / 1000;
      const thr = 0.5 + 0.5 * Math.sin(t * 1.3);
      const brk = Math.max(0, Math.sin(t * 0.9 + 2)) ** 2;
      if (throttle.current) throttle.current.style.height = `${(thr * 100).toFixed(1)}%`;
      if (brake.current) brake.current.style.height = `${(brk * 100).toFixed(1)}%`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="panel inputs">
      <div className="bar-track">
        <div ref={brake} className="bar brake" />
      </div>
      <div className="bar-track">
        <div ref={throttle} className="bar throttle" />
      </div>
    </div>
  );
}
