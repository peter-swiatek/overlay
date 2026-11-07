import type { OverlayManifest } from "@overlay/overlays/contract";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OVERLAY_MANIFESTS } from "@overlay/overlays/manifests";
import { defaultInstanceSettings } from "@overlay/overlays/settings";
import { OverlayFrame } from "./OverlayFrame";

const first = OVERLAY_MANIFESTS[0];
if (!first) throw new Error("no manifests");
const manifest: OverlayManifest = first;

function render(editing: boolean, showTitleBar: boolean): string {
  const common = { ...defaultInstanceSettings(manifest).common, showTitleBar };
  return renderToStaticMarkup(
    <OverlayFrame manifest={manifest} common={common} editing={editing}>
      <i>content</i>
    </OverlayFrame>,
  );
}

describe("OverlayFrame title bar", () => {
  it("has no bar when locked and the setting is off", () => {
    const html = render(false, false);
    expect(html).not.toContain("ov-titlebar");
    expect(html).toContain('data-titlebar="false"');
  });

  it("overlays a bar while editing with the setting off", () => {
    const html = render(true, false);
    expect(html).toContain("ov-titlebar");
    expect(html).toContain('data-edit="true"');
    expect(html).toContain('data-titlebar="false"');
    expect(html).not.toContain("edit-name");
  });

  it("puts the bar in flow when the setting is on", () => {
    const html = render(false, true);
    expect(html).toContain("ov-titlebar");
    expect(html).toContain('data-titlebar="true"');
  });

  it("names the overlay by its manifest title, outside the zoom wrapper", () => {
    const html = render(true, true);
    expect(html).toContain(`<span class="ov-titlebar-name">${manifest.title}</span>`);
    expect(html.indexOf("ov-titlebar")).toBeLessThan(html.indexOf("overlay-content"));
  });
});

describe("OverlayFrame for table overlays", () => {
  it("renders the frame like any other (a table just reports no content minimum)", () => {
    const table = OVERLAY_MANIFESTS.find((m) => m.table);
    if (!table) throw new Error("no table manifest");
    const common = defaultInstanceSettings(table).common;
    const html = renderToStaticMarkup(
      <OverlayFrame manifest={table} common={common} editing={false}>
        <i>rows</i>
      </OverlayFrame>,
    );
    expect(html).toContain("overlay-fit");
    expect(html).toContain("<i>rows</i>");
  });
});
