import { useMemo } from "react";
import { useOnlineNow } from "../../clock";
import { useCountdownText } from "../useCountdownText";

/**
 * How far the server's clock runs ahead of this machine's, from a view's `serverNow` read just
 * now (C-5 C5-11). Worked out again whenever a new view arrives.
 */
export function useServerOffset(serverNow: string | undefined): number {
  return useMemo(() => {
    if (!serverNow) return 0;
    const server = Date.parse(serverNow);
    return Number.isNaN(server) ? 0 : server - Date.now();
  }, [serverNow]);
}

/**
 * The time left until `endsAt` by the server's clock (C-5 C5-7): the shell's tick moved by the
 * server's offset, so a machine a few seconds off still counts the last seconds right.
 */
export function useServerCountdown(
  endsAt: string | undefined,
  offsetMs: number,
): { text: string | null; millisLeft: number } {
  const now = useOnlineNow() + offsetMs;
  const shifted = endsAt ? new Date(Date.parse(endsAt) - offsetMs).toISOString() : undefined;
  const text = useCountdownText(shifted);
  const millisLeft = endsAt ? Math.max(0, Date.parse(endsAt) - now) : 0;
  return { text, millisLeft };
}
