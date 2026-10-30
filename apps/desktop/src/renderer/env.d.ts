import type { OverlayApi } from "../shared/types";

declare global {
  interface Window {
    overlayApi: OverlayApi;
  }
}
