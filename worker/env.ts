import type { Role } from "../shared/domain";

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  LOGIN_LIMITER?: RateLimit;
  TIMEZONE: string;
}

export interface SessionUser {
  id: string;
  name: string;
  username: string;
  role: Role;
  color: string;
}

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } };
