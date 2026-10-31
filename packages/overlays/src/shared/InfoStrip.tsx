import type { InfoItem } from "./info";
import "./driver-table.css";

/** `label value` pairs in one wrapping row; null for no items. */
export function InfoStrip({
  items,
  className,
}: {
  items: readonly InfoItem[];
  className?: string;
}): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <div className={className ? `ov-info-strip ${className}` : "ov-info-strip"}>
      {items.map((item) => (
        <span
          key={item.id}
          className={`ov-info-item${item.unavailable ? " ov-info-item--unavailable" : ""}`}
        >
          <span className="ov-info-label">{item.label}</span>
          {item.value}
        </span>
      ))}
    </div>
  );
}
