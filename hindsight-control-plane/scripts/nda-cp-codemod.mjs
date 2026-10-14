#!/usr/bin/env node
/**
 * Convert API routes from the fixed module-level dataplane client to the
 * request-scoped accessors in @/lib/hindsight-client:
 *
 *   lowLevelClient        -> (await getClient())
 *   hindsightClient       -> (await getHindsightClient())
 *   getDataplaneHeaders(  -> (await getDataplaneHeaders(
 *
 * and rewrites the corresponding imports. Idempotent and re-runnable (used on
 * each upstream upgrade). Pass --check to fail (exit 1) if any file would
 * change, without writing — the lint gate in CI.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const CHECK = process.argv.includes("--check");
const ROOT = new URL("../src/app/api/", import.meta.url).pathname;

function listRouteFiles() {
  // Node's fs.globSync exists in 22+, but keep it portable via find.
  const out = execSync(`find ${ROOT} -name '*.ts'`, { encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

const IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/hindsight-client["'];?/;

function rewriteImport(spec) {
  const names = spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const out = new Set();
  for (const n of names) {
    if (n === "lowLevelClient") out.add("getClient");
    else if (n === "hindsightClient") out.add("getHindsightClient");
    else out.add(n);
  }
  return `import { ${[...out].join(", ")} } from "@/lib/hindsight-client";`;
}

function transform(src) {
  let out = src;
  const m = out.match(IMPORT_RE);
  if (m) out = out.replace(IMPORT_RE, rewriteImport(m[1]));
  // Usages (identifiers, not the import which is already rewritten above).
  out = out.replace(/\blowLevelClient\b/g, "(await getClient())");
  out = out.replace(/\bhindsightClient\b/g, "(await getHindsightClient())");
  // Only add await to call sites, never to the import name.
  out = out.replace(/(?<!await\s)\bgetDataplaneHeaders\(/g, "await getDataplaneHeaders(");
  return out;
}

let changed = 0;
for (const file of listRouteFiles()) {
  const src = readFileSync(file, "utf8");
  if (!src.includes("@/lib/hindsight-client")) continue;
  const out = transform(src);
  if (out !== src) {
    changed++;
    if (CHECK) {
      console.error(`would change: ${file}`);
    } else {
      writeFileSync(file, out);
      console.log(`updated: ${file}`);
    }
  }
}

if (CHECK && changed > 0) {
  console.error(`\n${changed} route(s) still use a module-level dataplane client. Run scripts/nda-cp-codemod.mjs.`);
  process.exit(1);
}
console.log(`${CHECK ? "checked" : "done"}: ${changed} file(s)${CHECK ? " would change" : " changed"}.`);
