import { useRef, type PointerEvent } from "react";

/** Dashed outline, name label (drag region) and a bottom-right grip that resizes via IPC. */
export function EditFrame({ name }: { name: string }) {
  const last = useRef<{ x: number; y: number } | null>(null);

  const onDown = (e: PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = { x: e.screenX, y: e.screenY };
  };
  const onMove = (e: PointerEvent<HTMLDivElement>): void => {
    const prev = last.current;
    if (!prev) return;
    const dx = e.screenX - prev.x;
    const dy = e.screenY - prev.y;
    if (dx === 0 && dy === 0) return;
    last.current = { x: e.screenX, y: e.screenY };
    window.overlayApi.resizeBy(dx, dy);
  };
  const onUp = (e: PointerEvent<HTMLDivElement>): void => {
    last.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div className="edit-frame">
      <span className="edit-name">{name}</span>
      <div
        className="edit-grip"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
    </div>
  );
}
