import { Hono } from "hono";
import { requireUser } from "./auth";
import type { AppEnv } from "./env";
import { authRoutes } from "./routes/auth";
import { jobRoutes, listRoutes, photoRoutes } from "./routes/jobs";
import { teamRoutes } from "./routes/team";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", async (c, next) => {
  await next();
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "same-origin");
  if (!c.res.headers.has("cache-control")) c.header("cache-control", "no-store");
});

// Everything except sign-in/setup needs a signed-in user. (/me checks for itself.)
const PUBLIC = new Set(["/api/setup", "/api/login", "/api/logout", "/api/me", "/api/me/password"]);
app.use("*", (c, next) => (PUBLIC.has(c.req.path) ? next() : requireUser(c, next)));

app.route("/", authRoutes);
app.route("/team", teamRoutes);
app.route("/jobs", jobRoutes);
app.route("/photos", photoRoutes);
app.route("/", listRoutes);

app.notFound((c) => c.json({ error: "Not found." }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Something went wrong. Try again." }, 500);
});

export default app;
