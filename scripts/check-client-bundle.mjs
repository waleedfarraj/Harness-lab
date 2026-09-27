// Scans the built client assets (.next/static) for Token Factory secrets.
// Run after `npm run build`. Exits non-zero if anything suspicious is found.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const staticDir = ".next/static";
if (!existsSync(staticDir)) {
  console.error("No .next/static directory. Run `npm run build` first.");
  process.exit(1);
}

const needles = ["NEBIUS_API_KEY", "Bearer "];
if (existsSync(".env.local")) {
  const match = readFileSync(".env.local", "utf8").match(/^NEBIUS_API_KEY=(.+)$/m);
  const key = match?.[1].trim().replace(/^["']|["']$/g, "");
  if (key) needles.push(key);
}

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(staticDir);

const hits = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  needles.forEach((needle, i) => {
    // Label the real key generically so this script never prints it.
    if (text.includes(needle)) hits.push(`${file}: contains ${i < 2 ? JSON.stringify(needle) : "the NEBIUS_API_KEY value"}`);
  });
}

if (hits.length) {
  console.error("Possible secret exposure in client bundle:\n" + hits.join("\n"));
  process.exit(1);
}
console.log(`OK: scanned ${files.length} client files; no Token Factory secrets found.`);
