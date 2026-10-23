import { Channel, invoke } from "@tauri-apps/api/core";

/**
 * How the online mode follows a live channel (phase 3 S-8e). The webview has no network of its
 * own: the Rust client holds the one WebSocket to the gateway, with the session's token, and
 * pushes each channel's messages to the screen that watches it over a Tauri channel. A test swaps
 * the transport.
 */

/** What the Rust client hands a watch (`src-tauri/src/application/realtime`). */
export type RealtimeMessage =
  | { kind: "frame"; channel: string; seq: number; data: unknown }
  | { kind: "notice"; channel: string; data: unknown }
  | {
      kind: "status";
      state: "connecting" | "open" | "reconnecting" | "closed";
      code?: string;
    }
  | { kind: "error"; channel: string; code: string };

export interface OnlineRealtime {
  /**
   * Follow `channel` (`match:<id>` from `lastSeq`, or `league:<id>`); resolves to a function that
   * stops the watch.
   */
  watch(
    channel: string,
    lastSeq: number | undefined,
    onMessage: (message: RealtimeMessage) => void,
  ): Promise<() => Promise<void>>;
}

/** The desktop build: the Rust realtime client, over Tauri IPC. */
export const tauriOnlineRealtime: OnlineRealtime = {
  watch: async (channel, lastSeq, onMessage) => {
    const onMessageChannel = new Channel<RealtimeMessage>();
    onMessageChannel.onmessage = onMessage;
    const id = await invoke<number>("online_watch", {
      channel,
      lastSeq: lastSeq ?? null,
      onMessage: onMessageChannel,
    });
    return () => invoke<void>("online_unwatch", { id });
  },
};

let activeRealtime: OnlineRealtime = tauriOnlineRealtime;

/** Follow live channels through `realtime` until the returned function restores the last. */
export function setOnlineRealtime(realtime: OnlineRealtime): () => void {
  const previous = activeRealtime;
  activeRealtime = realtime;
  return () => {
    activeRealtime = previous;
  };
}

/** Follow `channel` through the active realtime transport. */
export function watchChannel(
  channel: string,
  lastSeq: number | undefined,
  onMessage: (message: RealtimeMessage) => void,
): Promise<() => Promise<void>> {
  return activeRealtime.watch(channel, lastSeq, onMessage);
}
