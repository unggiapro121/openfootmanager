import { invoke } from "./transport";

/**
 * How the online client reaches the online API (phase 3 E3-6c). The webview has no network of
 * its own: every request goes to the Rust proxy `online_request`, which holds the session's
 * tokens, checks the request against its route table and sends it. A test swaps the transport.
 */
export type OnlineMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** One request, as the proxy takes it: unencoded path segments, never a path string. */
export interface OnlineRequest {
  method: OnlineMethod;
  segments: string[];
  query?: [string, string][];
  body?: unknown;
  ifMatch?: string;
  idempotencyKey?: string;
}

/** A successful answer. */
export interface OnlineResponse<T> {
  status: number;
  body: T;
  retryAfterSeconds?: number;
  contractRevision?: number;
}

/**
 * A failed one, as the proxy rejects: the server's error envelope, or the proxy's own code
 * (`be.error.online.*`, status 0) when nothing was answered.
 */
export interface OnlineFailure {
  status: number;
  code: string;
  detail?: string;
  details?: unknown;
  retryAfterSeconds?: number;
  contractRevision?: number;
}

export interface OnlineTransport {
  request<T>(request: OnlineRequest): Promise<OnlineResponse<T>>;
}

/** The desktop build: the Rust proxy, over Tauri IPC. */
export const tauriOnlineTransport: OnlineTransport = {
  request: <T>(request: OnlineRequest) => invoke<OnlineResponse<T>>("online_request", { request }),
};

let activeTransport: OnlineTransport = tauriOnlineTransport;

/** Route every online request through `transport` until the returned function restores the last. */
export function setOnlineTransport(transport: OnlineTransport): () => void {
  const previous = activeTransport;
  activeTransport = transport;
  return () => {
    activeTransport = previous;
  };
}

/** Send `request` through the active online transport. */
export function onlineRequest<T>(request: OnlineRequest): Promise<OnlineResponse<T>> {
  return activeTransport.request<T>(request);
}
