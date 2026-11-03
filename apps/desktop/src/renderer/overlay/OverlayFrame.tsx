import { useRef, type CSSProperties, type ReactNode } from "react";
import type { CommonOverlaySettings, OverlayManifest } from "@overlay/overlays/contract";
import { useReportContentMin } from "./contentMin";
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

/** The overlay's name above it. Chrome: fixed px, outside the zoom and opacity wrapper. */
export function TitleBar({ name }: { name: string }) {
  return (
    <div className="ov-titlebar">
      <span className="ov-titlebar-name">{name}</span>
    </div>
  );
}

/** Root of an overlay window: scaled, faded content with the edit frame on top, unscaled. */
export function OverlayFrame({ manifest, common, editing, children }: Props) {
  const fitRef = useRef<HTMLDivElement>(null);
  // Tables may drop rows, so only their width is a hard minimum; other overlays need both.
  useReportContentMin(fitRef, !manifest.table, common.showTitleBar);
  return (
    <div className="overlay" data-edit={editing} data-titlebar={common.showTitleBar}>
      {(editing || common.showTitleBar) && <TitleBar name={manifest.title} />}
      <div className="overlay-content" style={contentStyle(common, manifest.table)}>
        <div className="overlay-fit" ref={fitRef}>
          {children}
        </div>
      </div>
      {editing && <EditFrame />}
    </div>
  );
}
