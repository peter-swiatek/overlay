import type { CSSProperties, ReactNode } from "react";
import type { CommonOverlaySettings, OverlayManifest } from "@overlay/overlays/contract";
import { EditFrame } from "./EditFrame";

/** Style of the wrapper that applies opacity, scale and (for tables) row opacity to the content. */
export function contentStyle(
  common: Pick<CommonOverlaySettings, "opacityPct" | "scalePct" | "rowOpacityPct">,
  table: boolean,
): CSSProperties {
  const style: CSSProperties & Record<string, string | number> = {
    opacity: common.opacityPct / 100,
    // CSS zoom, never webContents.setZoomFactor: Chromium shares that zoom per origin.
    zoom: common.scalePct / 100,
  };
  if (table) style["--ov-row-opacity"] = common.rowOpacityPct / 100;
  return style;
}

interface Props {
  manifest: OverlayManifest;
  common: CommonOverlaySettings;
  editing: boolean;
  children: ReactNode;
}

/** Root of an overlay window: scaled, faded content with the edit frame on top, unscaled. */
export function OverlayFrame({ manifest, common, editing, children }: Props) {
  return (
    <div className="overlay">
      <div className="overlay-content" style={contentStyle(common, manifest.table)}>
        {children}
      </div>
      {editing && <EditFrame name={manifest.title} />}
    </div>
  );
}
