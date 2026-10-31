import {
  COMMON_LIMITS,
  type OverlayInstanceSettings,
  type OverlayManifest,
  type SettingValue,
} from "../contract";

/** Settings a fresh install starts with: every field and setting at its manifest default. */
export function defaultInstanceSettings(manifest: OverlayManifest): OverlayInstanceSettings {
  const options: Record<string, SettingValue> = {};
  for (const setting of manifest.settings) options[setting.key] = setting.default;
  return {
    enabled: manifest.defaultEnabled,
    common: {
      opacityPct: COMMON_LIMITS.opacityPct.default,
      scalePct: COMMON_LIMITS.scalePct.default,
      rowOpacityPct: COMMON_LIMITS.rowOpacityPct.default,
      hideInGarage: false,
      hideOnTrack: false,
      alwaysShow: false,
      fields: manifest.fields.map((f) => ({
        id: f.id,
        visible: f.defaultVisible,
        widthPct: null,
      })),
    },
    options,
  };
}

/** Stub: the settings ticket validates `raw`; until then every input gives the defaults. */
export function sanitizeInstanceSettings(
  manifest: OverlayManifest,
  raw: unknown,
): OverlayInstanceSettings {
  void raw;
  return defaultInstanceSettings(manifest);
}
