import { type InvokeArgs, invoke as tauriInvoke } from "@tauri-apps/api/core";

/**
 * How the frontend reaches the game backend. Every service calls `invoke` from
 * this module rather than from `@tauri-apps/api/core`, so the desktop IPC is
 * one implementation among possible others: an online client will speak to a
 * server instead, without a component or a service changing.
 */
export interface GameTransport {
  invoke<T>(command: string, args?: InvokeArgs): Promise<T>;
}

/** The desktop build: Tauri IPC into the Rust backend in the same process. */
export const tauriTransport: GameTransport = {
  // Forward exactly what the caller passed: a command sent without arguments
  // reaches Tauri as a one-argument call, as it did before this layer existed.
  invoke: <T>(command: string, args?: InvokeArgs) =>
    args === undefined ? tauriInvoke<T>(command) : tauriInvoke<T>(command, args),
};

let activeTransport: GameTransport = tauriTransport;

/**
 * Route every service call through `transport` until the returned function is
 * called, which restores the previous one.
 */
export function setGameTransport(transport: GameTransport): () => void {
  const previous = activeTransport;
  activeTransport = transport;
  return () => {
    activeTransport = previous;
  };
}

/** Send `command` to the backend through the active transport. */
export function invoke<T>(command: string, args?: InvokeArgs): Promise<T> {
  return activeTransport.invoke<T>(command, args);
}
