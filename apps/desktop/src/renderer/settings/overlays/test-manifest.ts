import type { OverlayManifest } from "@overlay/overlays/contract";

/** A made-up manifest with every SettingField kind, two sections and four fields. */
export const testManifest: OverlayManifest = {
  id: "test-panel",
  title: "Test Panel",
  description: "Only for tests.",
  sims: ["iracing", "lmu"],
  defaultSize: { width: 300, height: 200 },
  minSize: { width: 100, height: 100 },
  defaultPosition: { x: 0, y: 0 },
  table: false,
  fields: [
    { id: "a", label: "Alpha", defaultVisible: true },
    { id: "b", label: "Bravo", defaultVisible: true, defaultWidthPct: 25 },
    { id: "c", label: "Charlie", defaultVisible: false },
    { id: "d", label: "Delta stint", defaultVisible: true, sims: ["lmu"] },
  ],
  settings: [
    {
      key: "size",
      label: "Bar size",
      kind: "number",
      default: 20,
      min: 10,
      max: 40,
      step: 2,
      unit: "px",
      section: "Layout",
    },
    {
      key: "mode",
      label: "Mode choice",
      kind: "select",
      default: "plain",
      section: "Layout",
      options: [
        { value: "plain", label: "Plain" },
        { value: "fancy", label: "Fancy", sims: ["lmu"] },
      ],
    },
    { key: "tint", label: "Tint colour", kind: "colour", default: "accent", section: "Colours" },
    {
      key: "flash",
      label: "Flash on change",
      kind: "toggle",
      default: true,
      section: "Colours",
      help: "Blink briefly.",
    },
    {
      key: "extras",
      label: "Extra items",
      kind: "multi",
      default: ["x"],
      max: 2,
      options: [
        { value: "x", label: "Ex" },
        { value: "y", label: "Why" },
        { value: "z", label: "Zed", sims: ["lmu"] },
      ],
    },
    {
      key: "gap",
      label: "Gap distance",
      kind: "number",
      default: 50,
      min: 0,
      max: 200,
      step: 5,
      unit: "m",
      sims: ["lmu"],
    },
  ],
  rateHz: 10,
  defaultEnabled: true,
};

export const testTableManifest: OverlayManifest = {
  ...testManifest,
  id: "test-table",
  table: true,
};
