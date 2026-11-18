import { moduleById, parseInstanceId } from "@overlay/overlays";
import { OverlayHost } from "./OverlayHost";

let warnedId: string | null | undefined;

export function App() {
  // An instance id: the manifest id, or "<manifest id>:<n>" for an added instance.
  const id = new URLSearchParams(window.location.search).get("id");
  const ref = id === null ? null : parseInstanceId(id);
  const module = ref === null ? undefined : moduleById(ref.overlayId);
  if (!module || id === null) {
    if (warnedId !== id) {
      warnedId = id;
      console.error(`Unknown overlay id "${id ?? ""}"; nothing to render`);
    }
    return null;
  }
  return <OverlayHost module={module} instanceId={id} />;
}
