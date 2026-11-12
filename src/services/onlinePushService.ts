import { addPluginListener } from "@tauri-apps/api/core";
import { isMobileBuild } from "../lib/platform";
import { onlineRequest } from "./onlineTransport";
import { invoke } from "./transport";

/**
 * The phone's push plugin (`src-tauri/plugins/push`, phase 5 M3c2, m3-tech-spec §5.3–5.7) and the
 * app's installation id. Every command rejects on the desktop, where there is no push.
 */

/** Whether the phone shows the app's pushes; `prompt` while the system may still ask. */
export type PushPermission = "granted" | "denied" | "prompt";

/** A push's data as the phone hands it over (`kind`, `outboxId`, `route`, ids): all strings. */
export type OpenedPushData = Partial<Record<string, string>>;

const PLUGIN = "ofm-push";
const INSTALLATION_KEY = "ofm.push.installationId";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function pushPermissionState(): Promise<PushPermission> {
  return invoke<PushPermission>(`plugin:${PLUGIN}|permission_state`);
}

/** The system's own question; answers at once when it can no longer ask. */
export function requestPushPermission(): Promise<PushPermission> {
  return invoke<PushPermission>(`plugin:${PLUGIN}|request_permission`);
}

/** The token the server sends this phone's pushes to; rejects when the platform gives none. */
export function pushToken(): Promise<string> {
  return invoke<string>(`plugin:${PLUGIN}|token`);
}

/** The push the app was opened from and nobody took yet, taken now; null when none. */
export function takeOpenedPush(): Promise<OpenedPushData | null> {
  return invoke<OpenedPushData | null>(`plugin:${PLUGIN}|take_opened`);
}

/** The phone's notification settings for this app, where a refusal can be undone. */
export async function openPushSettings(): Promise<void> {
  await invoke<unknown>(`plugin:${PLUGIN}|open_settings`);
}

/**
 * Run `handler` on the plugin's event: `opened` (a push tapped while the app runs; take it with
 * `takeOpenedPush`) or `token` (a new token to register). Resolves to the function that stops.
 */
export async function onPushEvent(
  event: "opened" | "token",
  handler: () => void,
): Promise<() => void> {
  const listener = await addPluginListener(PLUGIN, event, () => handler());
  return () => {
    void listener.unregister();
  };
}

function storedInstallationId(): string | null {
  try {
    const stored = localStorage.getItem(INSTALLATION_KEY);
    return stored !== null && UUID.test(stored) ? stored : null;
  } catch {
    // Storage blocked: the id is made again, and the server drops the old row when the same
    // token registers under the new one.
    return null;
  }
}

/**
 * This install's id, made once and kept in the webview's storage, which goes with the app when
 * it is removed (§5.5). Lost storage only makes a new one.
 */
export function pushInstallationId(): string {
  const stored = storedInstallationId();
  if (stored !== null) return stored;
  const made = crypto.randomUUID();
  try {
    localStorage.setItem(INSTALLATION_KEY, made);
  } catch {
    // Not kept: the next read makes another, which registers the same way.
  }
  return made;
}

/**
 * Forget this phone's installation on the server, before the coach logs out (the call needs his
 * session). Nothing on the desktop, nor when this install never made an id.
 */
export async function forgetPushDevice(): Promise<void> {
  if (!isMobileBuild()) return;
  const id = storedInstallationId();
  if (id === null) return;
  await onlineRequest<null>({ method: "DELETE", segments: ["v1", "me", "push-devices", id] });
}
