import { useTelemetry } from "../telemetry/useTelemetry";
import { formatGap, formatLap, relativeRows, statusNotice } from "../telemetry/views";

const UPDATE_HZ = 10;

/** Relative table: three cars ahead, the player and three behind, refreshed at 10 Hz. */
export function DemoRelative() {
  const notice = useTelemetry(statusNotice, UPDATE_HZ);
  const rows = useTelemetry(relativeRows, UPDATE_HZ);

  if (notice !== null) return <div className="panel notice">{notice}</div>;

  return (
    <table className="panel relative">
      <tbody>
        {rows.map((r) => (
          <tr key={r.carIdx} className={r.isPlayer ? "me" : undefined}>
            <td>{r.position ?? "-"}</td>
            <td className="car-number" style={{ borderLeftColor: r.classColour ?? "transparent" }}>
              {r.carNumber}
            </td>
            <td className="name">{r.name}</td>
            <td>{formatGap(r.gapS)}</td>
            <td>{formatLap(r.lastLapS)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
