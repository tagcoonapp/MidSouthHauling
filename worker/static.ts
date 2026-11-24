import { STATIC_ASSETS } from "./static-assets.generated";

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "x-frame-options": "DENY",
};

/** Serves the embedded web app. Unknown paths get index.html so the app's own routes work on refresh. */
export function serveStatic(req: Request): Response {
  const path = new URL(req.url).pathname;
  const asset = STATIC_ASSETS[path] ?? (path.startsWith("/assets/") ? undefined : STATIC_ASSETS["/index.html"]);
  if (!asset) return new Response("Not found", { status: 404 });
  const body = asset.base64 ? Uint8Array.from(atob(asset.body), (c) => c.charCodeAt(0)) : asset.body;
  // Vite puts a content hash in /assets/ file names, so those can be cached forever.
  const cache = path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
  return new Response(body, { headers: { "content-type": asset.type, "cache-control": cache, ...SECURITY_HEADERS } });
}
