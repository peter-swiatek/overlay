import type { Theme } from "@overlay/theme/types";
import {
  DataTable,
  formatDelta,
  formatDriverName,
  formatLapTime,
  IRatingPill,
  LicencePill,
  type TableColumn,
} from "@overlay/ui";
import type { FieldConfig } from "@overlay/ui/types";
import { ThemeScope } from "../ThemeScope";

interface SampleRow {
  id: number;
  pos: number;
  name: string;
  licence: string;
  iRating: number;
  best: number;
  fastest: boolean;
  delta: number;
  own: boolean;
}

// Invented drivers only.
const ROWS: readonly SampleRow[] = [
  {
    id: 1,
    pos: 1,
    name: "Max Example",
    licence: "A 4.12",
    iRating: 4120,
    best: 102.318,
    fastest: true,
    delta: -0.4,
    own: false,
  },
  {
    id: 2,
    pos: 2,
    name: "José María Pérez",
    licence: "B 3.40",
    iRating: 2650,
    best: 102.904,
    fastest: false,
    delta: 0.8,
    own: true,
  },
  {
    id: 3,
    pos: 3,
    name: "Zofia Świątkowska",
    licence: "C 2.75",
    iRating: 1830,
    best: 103.511,
    fastest: false,
    delta: 1.6,
    own: false,
  },
  {
    id: 4,
    pos: 4,
    name: "Ana Example",
    licence: "D 2.10",
    iRating: 980,
    best: 104.227,
    fastest: false,
    delta: -0.04,
    own: false,
  },
];

/** Colour by the rounded value: formatDelta prints "0.0" for -0.04. */
function deltaColour(delta: number): string {
  const text = formatDelta(delta, 1);
  if (text.startsWith("+")) return "var(--ov-locked-loss)";
  if (text.startsWith("-")) return "var(--ov-locked-gain)";
  return "var(--ov-text-muted)";
}

const COLUMNS: readonly TableColumn<SampleRow>[] = [
  { id: "pos", label: "Pos", align: "center", chars: 3, defaultWidthPct: 8, render: (r) => r.pos },
  {
    id: "name",
    label: "Driver",
    grow: true,
    chars: 18,
    defaultWidthPct: 38,
    render: (r) => formatDriverName(r.name, "full"),
  },
  {
    id: "licence",
    label: "Licence",
    align: "center",
    chars: 7,
    defaultWidthPct: 14,
    render: (r) => <LicencePill licence={r.licence} />,
  },
  {
    id: "ir",
    label: "iRating",
    align: "center",
    chars: 7,
    defaultWidthPct: 14,
    render: (r) => <IRatingPill iRating={r.iRating} licence={r.licence} tinted={false} />,
  },
  {
    id: "best",
    label: "Best",
    align: "right",
    chars: 9,
    defaultWidthPct: 16,
    render: (r) => (
      <span style={r.fastest ? { color: "var(--ov-locked-fastest)" } : undefined}>
        {formatLapTime(r.best)}
      </span>
    ),
  },
  {
    id: "delta",
    label: "Delta",
    align: "right",
    chars: 6,
    defaultWidthPct: 10,
    render: (r) => <span style={{ color: deltaColour(r.delta) }}>{formatDelta(r.delta, 1)}</span>,
  },
];
const CONFIG: readonly FieldConfig[] = COLUMNS.map((c) => ({
  id: c.id,
  visible: true,
  widthPct: null,
}));

function SpotterSample() {
  return (
    <div className="ed-spotter" aria-label="Spotter sample">
      <span className="ed-spotter-bar" />
      <span className="ed-spotter-block" />
      <span className="ed-spotter-bar" />
    </div>
  );
}

/** The draft theme drawn the way an overlay does, on a checkerboard that stands in for the sim. */
export function ThemePreview({ theme }: { theme: Theme }) {
  return (
    <div className="ed-backdrop">
      <ThemeScope theme={theme} className="ed-preview">
        <DataTable
          columns={COLUMNS}
          config={CONFIG}
          rows={ROWS}
          rowKey={(r) => r.id}
          widthMode="custom"
          showHeader
          isOwnRow={(r) => r.own}
        />
        <SpotterSample />
      </ThemeScope>
    </div>
  );
}
