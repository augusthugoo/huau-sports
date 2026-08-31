interface Env {
  HUAU_DB: D1Database;
  HUAU_ASSETS: R2Bucket;
  APP_ENV: "development" | "staging" | "production";
  APP_VERSION: string;
}
