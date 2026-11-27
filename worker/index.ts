import { Hono } from "hono";
import { requireUser } from "./auth";
import type { AppEnv } from "./env";
import { authRoutes } from "./routes/auth";
import { jobRoutes, listRoutes, photoRoutes } from "./routes/jobs";
import { teamRoutes } from "./routes/team";
import { pricingRoutes } from "./routes/pricing";
import { importRoutes } from "./routes/import";
import { noteRoutes } from "./routes/notes";
import { schedulingNoteRoutes } from "./routes/scheduling-notes";
import { accountingRoutes, fuelRoutes, truckCostRoutes } from "./routes/accounting";
import { serveStatic } from "./static";
import { rollOverMissedJobs } from "./rollover";
import type { Env } from "./env";

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
app.route("/pricing", pricingRoutes);
app.route("/import", importRoutes);
app.route("/notes", noteRoutes);
app.route("/scheduling-notes", schedulingNoteRoutes);
app.route("/fuel", fuelRoutes);
app.route("/truck-costs", truckCostRoutes);
app.route("/accounting", accountingRoutes);
app.route("/jobs", jobRoutes);
app.route("/photos", photoRoutes);
app.route("/", listRoutes);

app.notFound((c) => c.json({ error: "Not found." }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Something went wrong. Try again." }, 500);
});

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const path = new URL(req.url).pathname;
    if (path === "/api" || path.startsWith("/api/")) return app.fetch(req, env, ctx);
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    return serveStatic(req);
  },
  // Nightly (just after midnight Central): unsubmitted jobs from past days go back to the pipeline.
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(rollOverMissedJobs(env).then((n) => console.log(`rolled ${n} missed jobs back to the pipeline`)));
  },
} satisfies ExportedHandler<Env>;
