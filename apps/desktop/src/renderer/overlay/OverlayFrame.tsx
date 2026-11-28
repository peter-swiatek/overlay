import { useRef, type CSSProperties, type ReactNode } from "react";
import type {
  CommonOverlaySettings,
  FitContent,
  OverlayManifest,
} from "@overlay/overlays/contract";
import { useReportContentFit } from "./contentFit";
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
  /** Name in the title bar; defaults to the manifest title (added instances pass theirs). */
  title?: string;
  /**
   * Which window edges follow the content right now: the manifest's `fitContent` while the
   * overlay shows its own content, "none" while it shows a notice. Default "none".
   */
  fit?: FitContent;
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
export function OverlayFrame({ manifest, common, editing, title, fit = "none", children }: Props) {
  const fitRef = useRef<HTMLDivElement>(null);
  // Tables report nothing: main derives their width minimum from the column fit, and they may
  // drop rows and columns. Other overlays report both edges.
  // Some overlays keep the title bar in its own row while editing too (see the manifest).
  const titleBarInFlow = common.showTitleBar || (editing && manifest.editTitleBarInFlow === true);
  useReportContentMin(fitRef, true, titleBarInFlow, !manifest.table);
  useReportContentFit(fitRef, fit, titleBarInFlow);
  return (
    <div
      className="overlay"
      data-edit={editing}
      data-titlebar={titleBarInFlow}
      data-fit={fit === "none" ? undefined : fit}
    >
      {(editing || common.showTitleBar) && <TitleBar name={title ?? manifest.title} />}
      <div className="overlay-content" style={contentStyle(common, manifest.table)}>
        <div className="overlay-fit" ref={fitRef}>
          {children}
        </div>
      </div>
      {editing && <EditFrame />}
    </div>
  );
}
