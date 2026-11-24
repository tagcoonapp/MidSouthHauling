import type { Role } from "../shared/domain";

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  LOGIN_LIMITER?: RateLimit;
  TIMEZONE: string;
  /** Secret. Set in Cloudflare → midsouthhauling → Settings → Variables and Secrets. */
  ANTHROPIC_API_KEY?: string;
}

export interface SessionUser {
  id: string;
  name: string;
  username: string;
  role: Role;
  color: string;
}

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } };
