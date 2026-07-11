/**
 * Typed errors for the EIDOS platform API.
 *
 * Every error the workers return uses the envelope `{ error, message? }` plus,
 * for some statuses, extra fields (`current_version` on 412, `bytes_remaining`
 * on 402, `details` on an invalid patch, `retry_after` on 429). Those extras are
 * carried on `.extra` and, where useful, surfaced as typed properties.
 */

export interface ErrorBody {
  error?: string;
  message?: string;
  [key: string]: unknown;
}

export class EidosApiError extends Error {
  readonly status: number;
  /** Machine-readable `error` code from the response body. */
  readonly code?: string;
  /** Any additional fields the endpoint returned. */
  readonly extra: Record<string, unknown>;

  constructor(
    message: string,
    options: { status: number; code?: string; extra?: Record<string, unknown> },
  ) {
    super(message);
    this.name = new.target.name;
    this.status = options.status;
    this.code = options.code;
    this.extra = options.extra ?? {};
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BadRequest extends EidosApiError {}
/** 400 `invalid_patch` — the JSON Patch failed validation before apply. */
export class InvalidPatch extends BadRequest {
  get details(): unknown[] {
    return (this.extra.details as unknown[]) ?? [];
  }
}
export class Unauthorized extends EidosApiError {}
/** 402 `quota_exceeded`. `bytesRemaining` is present on ingestion finalize. */
export class QuotaExceeded extends EidosApiError {
  get bytesRemaining(): number | undefined {
    return this.extra.bytes_remaining as number | undefined;
  }
}
export class Forbidden extends EidosApiError {}
export class NotFound extends EidosApiError {}
/** 409 `patch_conflict` — the patch could not apply to the current spec. */
export class PatchConflict extends EidosApiError {}
/** 409 `conflict` — the resource is not in a writable state. */
export class Conflict extends EidosApiError {}
/** 411 — a `Content-Length` header is required. */
export class LengthRequired extends EidosApiError {}
/** 412 — the `If-Match` version did not match; `currentVersion` has the live one. */
export class PreconditionFailed extends EidosApiError {
  get currentVersion(): number | undefined {
    return this.extra.current_version as number | undefined;
  }
}
/** 413 — the body exceeds the server limit (ingestion 64 MiB). */
export class PayloadTooLarge extends EidosApiError {}
/** 429 — rate limited; `retryAfter` (seconds) may be present. */
export class RateLimited extends EidosApiError {
  get retryAfter(): string | undefined {
    return this.extra.retry_after as string | undefined;
  }
}
/** 5xx — an error on the EIDOS platform. */
export class ServerError extends EidosApiError {}

const BY_CODE: Record<string, typeof EidosApiError> = {
  invalid_patch: InvalidPatch,
  patch_conflict: PatchConflict,
  conflict: Conflict,
  quota_exceeded: QuotaExceeded,
  rate_limited: RateLimited,
  precondition_failed: PreconditionFailed,
};

const BY_STATUS: Record<number, typeof EidosApiError> = {
  400: BadRequest,
  401: Unauthorized,
  402: QuotaExceeded,
  403: Forbidden,
  404: NotFound,
  409: Conflict,
  411: LengthRequired,
  412: PreconditionFailed,
  413: PayloadTooLarge,
  429: RateLimited,
};

/** Build the most specific {@link EidosApiError} for a failed HTTP response. */
export async function errorFromResponse(
  response: Response,
): Promise<EidosApiError> {
  const status = response.status;
  let body: ErrorBody | undefined;
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    body = undefined;
  }
  const code = body?.error;
  const message = body?.message;
  const extra: Record<string, unknown> = {};
  if (body) {
    for (const [k, v] of Object.entries(body)) {
      if (k !== 'error' && k !== 'message') extra[k] = v;
    }
  }
  if (status === 429 && extra.retry_after === undefined) {
    const retry = response.headers.get('Retry-After');
    if (retry !== null) extra.retry_after = retry;
  }

  let Cls =
    (code ? BY_CODE[code] : undefined) ??
    BY_STATUS[status] ??
    (status >= 500 ? ServerError : EidosApiError);

  return new Cls(message ?? code ?? `HTTP ${status}`, { status, code, extra });
}
