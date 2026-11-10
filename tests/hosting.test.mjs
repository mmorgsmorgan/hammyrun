import test from "node:test";
import assert from "node:assert/strict";
import { createVercelConfig } from "../hosting/vercel-config.mjs";
import { createOriginPolicy } from "../server/origin.mjs";

test("Vercel configuration requires a valid external backend and prevents API response caching", () => {
  for (const value of [
    undefined,
    "http://backend.example",
    "https://backend.example/api",
    "https://user:password@backend.example",
    "https://backend.example?secret=value",
  ])
    assert.throws(() => createVercelConfig(value));
  const config = createVercelConfig("https://backend.up.railway.app/");
  assert.equal(config.framework, "vite");
  assert.equal(
    config.rewrites[0].destination,
    "https://backend.up.railway.app/api/:path*",
  );
  assert.ok(
    config.headers
      .find((rule) => rule.source === "/api/:path*")
      .headers.some(
        (h) => h.key === "Vercel-CDN-Cache-Control" && h.value === "no-store",
      ),
  );
});

test("configured public origin permits the frontend without trusting spoofed forwarded hosts", () => {
  const policy = createOriginPolicy("https://hammy.example/");
  const request = {
    protocol: "https",
    get: () => "backend.up.railway.app",
    headers: {
      origin: "https://hammy.example",
      "x-forwarded-host": "other.example",
    },
  };
  assert.equal(policy.allows(request), true);
  assert.equal(policy.originFor(request), "https://hammy.example");
  assert.equal(
    policy.allows({
      ...request,
      headers: {
        origin: "https://other.example",
        "x-forwarded-host": "other.example",
      },
    }),
    false,
  );
  assert.equal(
    policy.allows({ ...request, headers: { origin: "null" } }),
    false,
  );
  const standalone = createOriginPolicy();
  assert.equal(
    standalone.allows({
      ...request,
      headers: { origin: "https://backend.up.railway.app" },
    }),
    true,
  );
  assert.equal(standalone.allows(request), false);
  assert.throws(() => createOriginPolicy("https://hammy.example/some/path"));
});
