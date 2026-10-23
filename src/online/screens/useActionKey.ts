import { useRef } from "react";
import { OnlineApiError } from "../errors";

type Send<T> = (idempotencyKey: string) => Promise<T>;

/**
 * The idempotency key of one player action (E6-16, C-2 §4): made when the action is first sent,
 * sent again when the same action (same `payload`) is retried after no answer came back, and
 * dropped once the server answered, so the next press is a new action. A changed payload is a
 * new action: reusing the key for it would be refused as a mismatch.
 */
export function useActionKey(): { run: <T>(send: Send<T>, payload?: string) => Promise<T> } {
  const pending = useRef<{ key: string; payload: string } | null>(null);

  const run = async <T>(send: Send<T>, payload = ""): Promise<T> => {
    if (pending.current?.payload !== payload) {
      pending.current = { key: crypto.randomUUID(), payload };
    }
    try {
      const value = await send(pending.current.key);
      pending.current = null;
      return value;
    } catch (error) {
      // No answer (status 0): the server may have done it, so a retry must carry the same key.
      if (!(error instanceof OnlineApiError) || error.status !== 0) pending.current = null;
      throw error;
    }
  };

  return { run };
}
