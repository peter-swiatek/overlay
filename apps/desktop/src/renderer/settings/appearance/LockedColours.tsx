import { LOCKED_COLOURS } from "@overlay/theme";
import type { LockedColourKey } from "@overlay/theme/types";
import { Section } from "../controls";
import "./appearance.css";

export const LOCKED_GROUPS: readonly {
  title: string;
  items: readonly (readonly [LockedColourKey, string])[];
}[] = [
  {
    title: "Gains and losses",
    items: [
      ["gain", "Faster / gain"],
      ["loss", "Slower / loss"],
      ["fastest", "Fastest lap"],
    ],
  },
  {
    title: "Licence classes",
    items: [
      ["licenceR", "Licence R"],
      ["licenceD", "Licence D"],
      ["licenceC", "Licence C"],
      ["licenceB", "Licence B"],
      ["licenceA", "Licence A"],
      ["licencePro", "Licence Pro"],
    ],
  },
  {
    title: "Rejoin",
    items: [
      ["rejoinYellow", "Rejoin yellow"],
      ["rejoinRed", "Rejoin red"],
    ],
  },
  {
    title: "Lap graph",
    items: [
      ["lapFaster", "Lap faster"],
      ["lapSlower", "Lap slower"],
      ["sectorSlower", "Sector slower"],
    ],
  },
  {
    title: "Flags",
    items: [
      ["flagGreen", "Flag green"],
      ["flagYellow", "Flag yellow"],
      ["flagBlue", "Flag blue"],
      ["flagWhite", "Flag white"],
      ["flagRed", "Flag red"],
      ["flagBlack", "Flag black"],
    ],
  },
  {
    title: "Driving aids",
    items: [
      ["shift", "Shift light"],
      ["pitBox", "Pit box"],
      ["pitExit", "Pit exit"],
    ],
  },
];

/** Read-only legend: there is deliberately no input for a locked colour. */
export function LockedColours() {
  return (
    <Section
      title="Locked colours"
      description="Not part of any theme. No theme, import or share code can change these."
    >
      <div className="ap-locked">
        {LOCKED_GROUPS.map((group) => (
          <div key={group.title} className="ap-locked-group">
            <h3>{group.title}</h3>
            <ul>
              {group.items.map(([key, label]) => (
                <li key={key} data-key={key}>
                  <span className="ap-locked-chip" style={{ background: LOCKED_COLOURS[key] }} />
                  <span>{label}</span>
                  <code>{LOCKED_COLOURS[key]}</code>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="muted">Class colours come from the sim and are locked too.</p>
      </div>
    </Section>
  );
}
