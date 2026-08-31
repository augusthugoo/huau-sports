import fs from "node:fs";

const config = fs.readFileSync(new URL("../apps/web/wrangler.jsonc", import.meta.url), "utf8");
const placeholders = [...config.matchAll(/REPLACE_WITH_[A-Z0-9_]+/g)].map((m) => m[0]);
if (placeholders.length) {
  console.error(`Cloudflare provisioning incomplete: ${[...new Set(placeholders)].join(", ")}`);
  process.exit(1);
}
console.log("Cloudflare resource IDs are configured.");
