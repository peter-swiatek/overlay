import type { InfoItem } from "./info";
import "./driver-table.css";

function Item({ item }: { item: InfoItem }): JSX.Element {
  return (
    <span className={`ov-info-item${item.unavailable ? " ov-info-item--unavailable" : ""}`}>
      <span className="ov-info-label">{item.label}</span>
      <span className={item.tone === "fastest" ? "ov-info-value ov-fastest" : "ov-info-value"}>
        {item.value}
      </span>
    </span>
  );
}

/** `label value` pairs on one line; null for no items. */
export function InfoStrip({
  items,
  className,
  variant = "header",
  leftCount,
}: {
  items: readonly InfoItem[];
  className?: string;
  /** "header" (default): bottom border. "footer": top border, pushed to the bottom of a flex column. */
  variant?: "header" | "footer";
  /** Header only: put the first N items in a left group and the rest in a right group. */
  leftCount?: number;
}): JSX.Element | null {
  if (items.length === 0) return null;
  const classes = ["ov-info-strip"];
  if (variant === "footer") classes.push("ov-info-strip--footer");
  if (className) classes.push(className);
  if (variant !== "header" || leftCount === undefined) {
    return (
      <div className={classes.join(" ")}>
        {items.map((item) => (
          <Item key={item.id} item={item} />
        ))}
      </div>
    );
  }
  const n = Math.max(0, Math.min(items.length, Math.floor(leftCount)));
  return (
    <div className={classes.join(" ")}>
      <div className="ov-info-group">
        {items.slice(0, n).map((item) => (
          <Item key={item.id} item={item} />
        ))}
      </div>
      <div className="ov-info-group">
        {items.slice(n).map((item) => (
          <Item key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
