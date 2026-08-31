interface Env {
  HUAU_DB: D1Database;
  HUAU_ASSETS: R2Bucket;
  APP_ENV: "development" | "staging" | "production";
  APP_VERSION: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  PLATFORM_ADMIN_EMAILS?: string;
}
