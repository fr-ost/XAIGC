// Every failure the API returns on purpose goes through ApiError, so the
// extension can branch on a stable `code` instead of parsing messages.

export class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const errors = {
  badRequest: (message, code = "invalid_request") => new ApiError(400, code, message),
  unauthorized: (message = "Unknown or missing device token.") => new ApiError(401, "unauthorized", message),
  forbidden: (code, message) => new ApiError(403, code, message),
  notFound: (message = "Not found.") => new ApiError(404, "not_found", message),
  conflict: (code, message, extra) => new ApiError(409, code, message, extra),
  paymentRequired: (code, message, extra) => new ApiError(402, code, message, extra),
  tooMany: (code, message, retryAfterMs, extra = {}) =>
    new ApiError(429, code, message, { ...extra, retryAfter: Math.max(1, Math.ceil((retryAfterMs || 1000) / 1000)) }),
  upstream: (code, message, status = 502, extra) => new ApiError(status, code, message, extra),
};
