import { useEffect, useState } from "react";

interface Row {
  pos: number;
  name: string;
  gap: number;
  lap: number;
}

const NAMES = ["Alonso", "Bianchi", "Chen", "Dubois", "Evans", "Fischer", "Garcia", "Haas"];
const UPDATE_HZ = 10;

function makeRows(t: number): Row[] {
  return NAMES.map((name, i) => ({
    pos: i + 1,
    name,
    gap: i === 0 ? 0 : i * 1.3 + Math.sin(t / 700 + i) * 0.4,
    lap: 92 + i * 0.15 + Math.sin(t / 1100 + i * 1.7) * 0.3,
  }));
}

function formatLap(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

/** Fake relative table: 8 rows refreshed at 10 Hz. */
export function DemoRelative() {
  const [rows, setRows] = useState<Row[]>(() => makeRows(0));

  useEffect(() => {
    const timer = setInterval(() => setRows(makeRows(performance.now())), 1000 / UPDATE_HZ);
    return () => clearInterval(timer);
  }, []);

  return (
    <table className="panel relative">
      <tbody>
        {rows.map((r) => (
          <tr key={r.pos} className={r.pos === 4 ? "me" : undefined}>
            <td>{r.pos}</td>
            <td className="name">{r.name}</td>
            <td>{r.gap === 0 ? "-" : `+${r.gap.toFixed(1)}`}</td>
            <td>{formatLap(r.lap)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
