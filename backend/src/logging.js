const LOG_FORMAT = (tokens, req, res) => {
  const status = Number(tokens.status(req, res));

  const log = {
    time: new Date().toISOString(),
    method: tokens.method(req, res),
    url: tokens.url(req, res),
    status,
    length: Number(tokens.res(req, res, "content-length")) || 0, // NaN → 0
    response_time_ms: Number(tokens["response-time"](req, res)),
    ip: req.ip ?? req.headers["x-forwarded-for"] ?? "unknown",
    user_agent: req.headers["user-agent"] ?? null,
    request_id: req.headers["x-request-id"] ?? null, // trace correlation
    level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
  };

  return JSON.stringify(log);
};

export { LOG_FORMAT };
