import fs from "node:fs";

const source = fs.readFileSync(new URL("../apps/web/src/i18n.ts", import.meta.url), "utf8");
const esMatch = source.match(/es:\s*\{([\s\S]*?)\n\s*\},\n\s*en:/);
const enMatch = source.match(/en:\s*\{([\s\S]*?)\n\s*\},\n\s*\} as const/);
if (!esMatch || !enMatch) throw new Error("Could not parse translation dictionaries");
const keys = (block) => [...block.matchAll(/^\s*([A-Za-z0-9_]+):/gm)].map((m) => m[1]);
const es = new Set(keys(esMatch[1]));
const en = new Set(keys(enMatch[1]));
const missingEn = [...es].filter((key) => !en.has(key));
const missingEs = [...en].filter((key) => !es.has(key));
if (missingEn.length || missingEs.length) {
  console.error({ missingEn, missingEs });
  process.exit(1);
}
console.log(`Translations aligned: ${es.size} keys`);
