import { create } from "zustand";
import i18n from "../../i18n";
import { APP_VERSION } from "../../lib/appVersion";
import { isMobileBuild, mobilePlatform } from "../../lib/platform";
import {
  type OpenedPushData,
  type PushPermission,
  pushInstallationId,
  pushPermissionState,
  pushToken,
  requestPushPermission,
} from "../../services/onlinePushService";
import { online } from "../client";

/**
 * The phone's side of push (phase 5 M3c2, m3-tech-spec §5.4–5.5): registering the installation,
 * asking once, and reporting the answer once per install. Nothing here runs on the desktop.
 */

/** The explanation sheet was shown on this install (§5.4); lost storage only shows it again. */
const ASKED_KEY = "ofm.push.asked";
/** The system's answer reached the server (Qm3-10, counted once per install). */
const REPORTED_KEY = "ofm.push.permissionReported";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function flagged(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    // Storage blocked: as if never set, which at worst asks or reports once more.
    return false;
  }
}

function flag(key: string): void {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // Not kept: the same as a lost flag.
  }
}

/**
 * Register this installation's token, language and clock with the server (§5.5), when the phone
 * lets the app notify. Resolves to whether it registered.
 */
export async function registerPushDevice(): Promise<boolean> {
  if (!isMobileBuild()) return false;
  if ((await pushPermissionState()) !== "granted") return false;
  const token = await pushToken();
  await online.push.registerDevice(pushInstallationId(), {
    platform: mobilePlatform(),
    token,
    locale: i18n.resolvedLanguage ?? i18n.language,
    utcOffsetMinutes: -new Date().getTimezoneOffset(),
    appVersion: APP_VERSION,
  });
  return true;
}

async function reportOnce(state: PushPermission): Promise<void> {
  if (state === "prompt" || flagged(REPORTED_KEY)) return;
  await online.push.reportPermission(state === "granted");
  flag(REPORTED_KEY);
}

/**
 * The coach chose to turn notifications on: the system asks (or answers at once when it can no
 * longer ask), the answer is reported once per install, and a yes registers the phone.
 */
export async function enablePush(): Promise<PushPermission> {
  const state = await requestPushPermission();
  // The count is a measure only: its failure must not stop the phone registering.
  await reportOnce(state).catch(() => undefined);
  if (state === "granted") await registerPushDevice();
  return state;
}

/** Whether the explanation sheet is up; `settle` closes it for good on this install. */
export const usePushAsk = create<{ open: boolean; settle: () => void }>((set) => ({
  open: false,
  settle: () => {
    flag(ASKED_KEY);
    set({ open: false });
  },
}));

/**
 * After the coach's first successful bid or line-up save on the phone (D-P5-15): the app's
 * explanation, once per install. Its "Later" keeps the system's one question for another time.
 */
export function askForPushOnce(): void {
  if (!isMobileBuild() || flagged(ASKED_KEY)) return;
  usePushAsk.setState({ open: true });
}

/** The opened push's outbox id, to count it opened; only a UUID is sent on. */
export function openedOutboxId(data: OpenedPushData): string | undefined {
  const id = data.outboxId;
  return id !== undefined && UUID.test(id) ? id : undefined;
}
