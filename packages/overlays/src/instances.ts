import type { OverlayManifest } from "./contract";

/**
 * Overlay instances. Every overlay can run in several windows, each with its own settings and
 * window bounds. Instance 1 is keyed by the manifest id itself ("relative"), so settings and
 * layouts saved before instances existed stay valid. Added instances are keyed
 * "<manifest id>:<n>" with n from 2 to MAX_INSTANCES ("relative:2").
 */

export const INSTANCE_SEPARATOR = ":";

/** Most windows one overlay may have (instance 1 included). */
export const MAX_INSTANCES = 16;

export interface InstanceRef {
  /** The manifest id. */
  overlayId: string;
  /** 1 for the original instance, 2.. for added ones. */
  n: number;
}

const INSTANCE_RE = /^([a-z0-9]+(?:-[a-z0-9]+)*)(?::([1-9][0-9]*))?$/;

/** The key of instance `n` of an overlay. */
export function instanceId(overlayId: string, n: number): string {
  return n <= 1 ? overlayId : `${overlayId}${INSTANCE_SEPARATOR}${n}`;
}

/** Splits an instance key; null for anything that is not a canonical key ("x:1", "x:01", "x:17"). */
export function parseInstanceId(id: string): InstanceRef | null {
  const match = INSTANCE_RE.exec(id);
  if (!match) return null;
  const overlayId = match[1] as string;
  if (match[2] === undefined) return { overlayId, n: 1 };
  const n = Number(match[2]);
  return n >= 2 && n <= MAX_INSTANCES ? { overlayId, n } : null;
}

/** The manifest an instance key belongs to; undefined for unknown overlays and bad keys. */
export function manifestForInstance(
  id: string,
  manifests: readonly OverlayManifest[],
): OverlayManifest | undefined {
  const ref = parseInstanceId(id);
  return ref === null ? undefined : manifests.find((m) => m.id === ref.overlayId);
}

/** Instance number of a key (1 for a plain manifest id or anything unparsable). */
export function instanceNumber(id: string): number {
  return parseInstanceId(id)?.n ?? 1;
}

/** True for an added instance (n >= 2), the ones the user can remove. */
export function isAddedInstance(id: string): boolean {
  return instanceNumber(id) >= 2;
}

/** The overlay's instance keys among `ids`, ordered by instance number. */
export function instancesOf(overlayId: string, ids: Iterable<string>): string[] {
  const found: InstanceRef[] = [];
  for (const id of ids) {
    const ref = parseInstanceId(id);
    if (ref !== null && ref.overlayId === overlayId) found.push(ref);
  }
  return found.sort((a, b) => a.n - b.n).map((r) => instanceId(r.overlayId, r.n));
}

/** The lowest free instance key of an overlay, or null when it already has MAX_INSTANCES. */
export function nextInstanceId(overlayId: string, ids: Iterable<string>): string | null {
  const taken = new Set(instancesOf(overlayId, ids).map(instanceNumber));
  for (let n = 2; n <= MAX_INSTANCES; n++) {
    if (!taken.has(n)) return instanceId(overlayId, n);
  }
  return null;
}

/** Longest instance name the user can give. */
export const MAX_INSTANCE_NAME = 40;

/** The user's name for the instance, else the overlay title plus the number from instance 2. */
export function instanceTitle(
  manifest: Pick<OverlayManifest, "title">,
  id: string,
  name?: string,
): string {
  if (name !== undefined && name.trim() !== "") return name.trim();
  const n = instanceNumber(id);
  return n <= 1 ? manifest.title : `${manifest.title} ${n}`;
}
