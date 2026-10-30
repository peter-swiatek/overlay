import type { Clock } from "./shm";

export const LMU_REST_BASE = "http://127.0.0.1:6397";
export const LMU_REST_TIMEOUT_MS = 500;
export const LMU_NAVIGATION_PATH = "/navigation/state";
export const LMU_SWAGGER_PATH = "/swagger-schema.json";

/** The only paths the capture tool may request. Anything else is rejected before any I/O. */
export const LMU_REST_ALLOWLIST: readonly string[] = [
  LMU_SWAGGER_PATH,
  LMU_NAVIGATION_PATH,
  "/rest/watch/standings",
  "/rest/watch/sessionInfo",
  "/rest/strategy/usage",
  "/rest/strategy/pitstop-estimate",
  "/rest/garage/UIScreen/RepairAndRefuel",
  "/rest/garage/PitMenu/receivePitMenu",
  "/rest/garage/getPlayerGarageData",
  "/rest/sessions/weather",
  "/rest/sessions/GetGameState",
];

/** Endpoints polled during a session (everything except the one-off schema). */
export const LMU_REST_POLL_PATHS: readonly string[] = LMU_REST_ALLOWLIST.filter(
  (path) => path !== LMU_SWAGGER_PATH,
);

/** Known to crash the game (replay playback); never requested, even if someone adds it to the allowlist. */
const FORBIDDEN_PATH = /getvehiclecondition/i;

export class RestRequestRejected extends Error {}

export interface RestResult {
  path: string;
  status: number;
  latencyMs: number;
  body: unknown;
}

export type FetchLike = (
  url: string,
  init: { method: string; signal: AbortSignal; redirect: "error" },
) => Promise<{ status: number; text(): Promise<string> }>;

/** Read-only client for the LMU REST API: GET only, allowlisted paths only, one request at a time by the caller. */
export class LmuRestClient {
  constructor(
    private readonly clock: Clock,
    private readonly fetchFn: FetchLike = fetch as unknown as FetchLike,
    private readonly timeoutMs: number = LMU_REST_TIMEOUT_MS,
  ) {}

  get(path: string): Promise<RestResult> {
    return this.request("GET", path);
  }

  async request(method: string, path: string): Promise<RestResult> {
    if (method !== "GET") throw new RestRequestRejected(`Only GET is allowed, got ${method}`);
    if (FORBIDDEN_PATH.test(path)) throw new RestRequestRejected(`Forbidden path ${path}`);
    if (!LMU_REST_ALLOWLIST.includes(path)) {
      throw new RestRequestRejected(`Path not in allowlist: ${path}`);
    }
    const started = this.clock.monoMs();
    try {
      const response = await this.fetchFn(`${LMU_REST_BASE}${path}`, {
        method: "GET",
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "error",
      });
      const text = await response.text();
      return {
        path,
        status: response.status,
        latencyMs: this.clock.monoMs() - started,
        body: parseBody(text),
      };
    } catch (error) {
      return {
        path,
        status: 0,
        latencyMs: this.clock.monoMs() - started,
        body: { error: error instanceof Error ? error.message : String(error) },
      };
    }
  }
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
