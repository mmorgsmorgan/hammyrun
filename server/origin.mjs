// Configure the browser-facing origin when an external proxy fronts this API.
// Do not use arbitrary forwarded-host headers to authorize browser requests.
export function createOriginPolicy(publicOrigin) {
  let configured = null;
  if (publicOrigin) {
    const url = new URL(publicOrigin);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error(
        "PUBLIC_ORIGIN must be the public website origin, without a path, query or credentials.",
      );
    configured = url.origin;
  }
  const originFor = (req) =>
    configured || `${req.protocol}://${req.get("host")}`;
  return {
    originFor,
    allows: (req) =>
      !req.headers.origin || req.headers.origin === originFor(req),
  };
}
