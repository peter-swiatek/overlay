import { moduleById } from "@overlay/overlays";
import { OverlayHost } from "./OverlayHost";

let warnedId: string | null | undefined;

export function App() {
  const id = new URLSearchParams(window.location.search).get("id");
  const module = id === null ? undefined : moduleById(id);
  if (!module) {
    if (warnedId !== id) {
      warnedId = id;
      console.error(`Unknown overlay id "${id ?? ""}"; nothing to render`);
    }
    return null;
  }
  return <OverlayHost module={module} />;
}
