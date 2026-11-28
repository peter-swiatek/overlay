import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataSourceSection, DeveloperPage } from "./DeveloperPage";

const noop = () => undefined;

describe("DataSourceSection", () => {
  it("shows the five sources, the checked one and the replay path", () => {
    const html = renderToStaticMarkup(
      <DataSourceSection
        view={{ source: "replay", replayPath: "C:\\fixtures\\example.ovfx" }}
        onSelect={noop}
        onPickReplay={noop}
      />,
    );
    for (const label of ["Auto", "iRacing", "LMU", "Mock", "Replay file"]) {
      expect(html).toContain(`>${label}</button>`);
    }
    expect(html).toMatch(/aria-pressed="true"[^>]*>Replay file</);
    expect(html).toContain("C:\\fixtures\\example.ovfx");
    expect(html).toContain("Choose replay file...");
  });

  it("says no file is chosen yet", () => {
    const html = renderToStaticMarkup(
      <DataSourceSection
        view={{ source: "auto", replayPath: null }}
        onSelect={noop}
        onPickReplay={noop}
      />,
    );
    expect(html).toContain("none chosen");
  });
});

describe("DeveloperPage", () => {
  it("renders its sections (effects do not run in static markup, so no API is called)", () => {
    const html = renderToStaticMarkup(<DeveloperPage />);
    for (const title of ["Data source", "Fixture recording", "Resource usage"]) {
      expect(html).toContain(`<h2>${title}</h2>`);
    }
    expect(html).toContain("Not recording");
  });
});
