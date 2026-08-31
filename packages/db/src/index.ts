import { drizzle } from "drizzle-orm/d1";

export { appMeta } from "./schema";

export function createDb(database: D1Database) {
  return drizzle(database);
}
