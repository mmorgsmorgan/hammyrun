// Vercel serves the Vite build and forwards API requests to the Railway service.
// Keep the browser on one origin so its HttpOnly wallet session works normally.
export function createVercelConfig(railwayUrl) {
  if (!railwayUrl)
    throw new Error(
      "Set RAILWAY_API_URL on Vercel to the Railway service's public HTTPS origin, then redeploy.",
    );
  const backend = new URL(railwayUrl);
  if (
    backend.protocol !== "https:" ||
    backend.username ||
    backend.password ||
    backend.search ||
    backend.hash ||
    backend.pathname !== "/"
  )
    throw new Error(
      "RAILWAY_API_URL must be an HTTPS origin such as https://your-service.up.railway.app, without a path or credentials.",
    );
  return {
    framework: "vite",
    buildCommand: "npm run build",
    outputDirectory: "dist",
    rewrites: [
      { source: "/api/:path*", destination: `${backend.origin}/api/:path*` },
      { source: "/((?!api(?:/|$)).*)", destination: "/index.html" },
    ],
    headers: [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://ethereum-sepolia-rpc.publicnode.com https://sepolia.drpc.org; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "CDN-Cache-Control", value: "no-store" },
          { key: "Vercel-CDN-Cache-Control", value: "no-store" },
          { key: "x-vercel-enable-rewrite-caching", value: "0" },
        ],
      },
    ],
  };
}
