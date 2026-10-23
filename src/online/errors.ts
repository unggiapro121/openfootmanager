import type { OnlineFailure } from "../services/onlineTransport";

/** What a code's translation is filled with: strings and numbers only (`details.params`). */
export type ErrorParamValues = Record<string, string | number>;

const SERVER_UNEXPECTED = "be.error.online.serverUnexpected";

function primitiveParams(details: unknown): ErrorParamValues {
  if (typeof details !== "object" || details === null || !("params" in details)) return {};
  const params = (details as { params: unknown }).params;
  if (typeof params !== "object" || params === null) return {};
  const values: ErrorParamValues = {};
  for (const [name, value] of Object.entries(params)) {
    if (typeof value === "string" || typeof value === "number") values[name] = value;
  }
  return values;
}

/**
 * `code?name=value&…`: the form `resolveBackendError` already translates, parameters included,
 * so an online error is shown with no new translation code.
 */
export function messageOf(code: string, params: ErrorParamValues): string {
  const entries = Object.entries(params).map(([name, value]) => [name, String(value)]);
  return entries.length === 0 ? code : `${code}?${new URLSearchParams(entries).toString()}`;
}

/**
 * An online request that failed. Compare `code`, never `message`: the message carries the
 * translation parameters too.
 */
export class OnlineApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly params: ErrorParamValues;
  readonly details: unknown;
  readonly retryAfterSeconds?: number;
  readonly contractRevision?: number;

  constructor(failure: OnlineFailure) {
    const params = primitiveParams(failure.details);
    if (failure.retryAfterSeconds !== undefined) {
      params.retryAfterSeconds = failure.retryAfterSeconds;
    }
    super(messageOf(failure.code, params));
    this.name = "OnlineApiError";
    this.code = failure.code;
    this.status = failure.status;
    this.params = params;
    this.details = failure.details;
    this.retryAfterSeconds = failure.retryAfterSeconds;
    this.contractRevision = failure.contractRevision;
  }
}

/** The proxy's rejection as an `OnlineApiError`; anything else is the server misbehaving. */
export function toOnlineApiError(rejection: unknown): OnlineApiError {
  if (rejection instanceof OnlineApiError) return rejection;
  if (
    typeof rejection === "object" &&
    rejection !== null &&
    typeof (rejection as { code?: unknown }).code === "string"
  ) {
    const failure = rejection as Partial<OnlineFailure> & { code: string };
    return new OnlineApiError({ ...failure, status: failure.status ?? 0 });
  }
  return new OnlineApiError({ status: 0, code: SERVER_UNEXPECTED });
}
