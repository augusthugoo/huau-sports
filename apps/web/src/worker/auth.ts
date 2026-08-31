import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { createDb } from "@huau/db";
import * as schema from "@huau/db/schema";

export function createAuth(env: Env) {
  const db = createDb(env.HUAU_DB);
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    account: {
      identityStrategy: "provider-id",
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      useSecureCookies: env.APP_ENV !== "development",
      database: { generateId: "uuid" },
    },
    trustedOrigins: [env.BETTER_AUTH_URL],
  });
}

export type HuauAuth = ReturnType<typeof createAuth>;
