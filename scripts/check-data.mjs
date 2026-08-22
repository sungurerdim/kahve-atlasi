#!/usr/bin/env node
/*
 * Coffee Atlas dataset invariant gate.
 *
 * SCOPE (declared, per ds-quality --invariant):
 *   Scans   : the single inline <script> of index.html — the drink dataset (CATEGORIES[].drinks[])
 *             and the step generators reachable through buildSteps().
 *   Exempts : the espresso family is exempt from the numeric ratio check (I7) until gap G1 is
 *             resolved, because its `ratio` field currently divides a gram dose by a millilitre
 *             volume. Named below in RATIO_EXEMPT with that reason.
 *   Blind to: whether the step *prose* is factually correct (that is gap G14, verified by sourcing,
 *             not by this gate); CSS; anything outside the inline script.
 *
 * Exit: 0 = all invariants hold. Non-zero = at least one violation, listed on stdout.
 */

import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const FILE = process.argv[2] ?? "index.html";
const MIN_DRINKS = 31; // inventory floor: the set may grow, never silently shrink

const failures = [];
const fail = (id, msg) => failures.push(`${id}: ${msg}`);

/* ---------- extract the inline script, anchored; unanchored => red, never a silent pass ---------- */
const html = readFileSync(FILE, "utf8");

const openTag = html.indexOf("<script>");
const closeTag = html.lastIndexOf("</script>");
if (openTag === -1 || closeTag === -1 || closeTag <= openTag) {
  console.error(`I0: could not locate the inline <script> block in ${FILE}. The gate cannot verify anything — treating as failure.`);
  process.exit(2);
}
let src = html.slice(openTag + "<script>".length, closeTag);

const IIFE_OPEN = "(function(){";
const IIFE_CLOSE = "})();";
const openAt = src.indexOf(IIFE_OPEN);
const closeAt = src.lastIndexOf(IIFE_CLOSE);
if (openAt === -1 || closeAt === -1) {
  console.error(`I0: the script is no longer wrapped in the expected IIFE (${IIFE_OPEN} … ${IIFE_CLOSE}). The gate's extraction anchors are stale — treating as failure so this is fixed, not skipped.`);
  process.exit(2);
}
let body = src.slice(openAt + IIFE_OPEN.length, closeAt);

// Strip the DOM bootstrap call so evaluation yields definitions only.
const BOOTSTRAP = /\n\s*render\(\);\s*$/;
if (!BOOTSTRAP.test(body)) {
  console.error("I0: expected a trailing `render();` bootstrap call and did not find one. Extraction anchors are stale — treating as failure.");
  process.exit(2);
}
body = body.replace(BOOTSTRAP, "\n");

/* ---------- evaluate definitions in an isolated context with an inert DOM ---------- */
const inert = new Proxy(function () {}, {
  get: (_t, p) => (p === Symbol.toPrimitive ? () => "" : inert),
  apply: () => inert,
  construct: () => inert,
  has: () => true,
  set: () => true,
});

const sandbox = { document: inert, window: inert, console, navigator: inert, localStorage: inert };
sandbox.globalThis = sandbox;
const ctx = createContext(sandbox);

try {
  runInContext(body, ctx, { filename: "index.html:inline-script" });
} catch (err) {
  console.error(`I0: the inline script failed to evaluate: ${err.message}`);
  process.exit(2);
}

const { CATEGORIES, buildSteps } = sandbox;
if (!Array.isArray(CATEGORIES)) { console.error("I0: CATEGORIES is not an array after evaluation."); process.exit(2); }
if (typeof buildSteps !== "function") { console.error("I0: buildSteps is not a function after evaluation."); process.exit(2); }

const pairs = [];
for (const cat of CATEGORIES) for (const d of cat.drinks ?? []) pairs.push([cat, d]);
const drinks = pairs.map(([, d]) => d);

/* ---------- I1 inventory floor ---------- */
if (drinks.length < MIN_DRINKS) {
  fail("I1", `drink count dropped to ${drinks.length}; floor is ${MIN_DRINKS}. Removing a drink is a deliberate act — lower MIN_DRINKS in this gate to accept it.`);
}

/* ---------- I2 required fields ---------- */
const REQUIRED = ["id", "name", "note", "dose", "vessel", "layers", "ratio", "roast", "grind", "temp", "time", "tool"];
for (const d of drinks) {
  for (const f of REQUIRED) {
    if (d[f] === undefined || d[f] === null || d[f] === "") fail("I2", `drink "${d.id ?? "<no id>"}" is missing required field \`${f}\``);
  }
  // `ratioLabel` is required exactly when a real ratio is shown. `ratio: "—"` means the drink has
  // no meaningful ratio (affogato: a shot over ice cream), and ingredientRows() suppresses the whole
  // row for it (index.html:1120) — so demanding a label there would be demanding dead content.
  if (d.ratio !== "—" && !d.ratioLabel) {
    fail("I2", `drink "${d.id}" states ratio ${d.ratio} but carries no \`ratioLabel\` to explain what the two sides are`);
  }
}

/* ---------- I3 bilingual completeness ---------- */
const BILINGUAL = ["name", "note", "grind", "time", "tool", "ratioLabel"];
const bothLangs = (v) => v && typeof v === "object" && !Array.isArray(v) &&
  typeof v.tr === "string" && v.tr.trim() !== "" && typeof v.en === "string" && v.en.trim() !== "";
for (const d of drinks) {
  for (const f of BILINGUAL) {
    if (d[f] === undefined) continue; // absence is I2's job, not I3's
    if (!bothLangs(d[f])) fail("I3", `drink "${d.id}" field \`${f}\` is not a complete {tr, en} pair`);
  }
}

/* ---------- I4 unique ids ---------- */
const seen = new Set();
for (const d of drinks) {
  if (seen.has(d.id)) fail("I4", `duplicate drink id "${d.id}"`);
  seen.add(d.id);
}

/* ---------- I5 steps render for every drink in both languages ---------- */
const POISON = ["undefined", "NaN", "[object Object]", "null"];
for (const lang of ["en", "tr"]) {
  sandbox.LANG = lang;
  for (const [cat, d] of pairs) {
    let steps;
    try { steps = buildSteps(cat, d); }
    catch (err) { fail("I5", `buildSteps threw for "${d.id}" [${lang}]: ${err.message}`); continue; }

    if (!Array.isArray(steps) || steps.length < 3) {
      fail("I5", `drink "${d.id}" [${lang}] produced ${Array.isArray(steps) ? steps.length : "no"} steps; a usable procedure needs at least 3`);
      continue;
    }
    for (const [i, s] of steps.entries()) {
      const where = `"${d.id}" [${lang}] step ${i + 1}`;
      if (!s || typeof s.role !== "string" || s.role.trim() === "") fail("I5", `${where} has no role label`);
      if (!s || typeof s.text !== "string" || s.text.trim() === "") { fail("I5", `${where} has no text`); continue; }
      for (const p of POISON) {
        if (s.text.includes(p)) fail("I5", `${where} leaked \`${p}\` into user-facing text: "${s.text.slice(0, 90)}"`);
      }
    }
  }
}
sandbox.LANG = "en";

/* ---------- I6 every drink routes to a step generator deliberately ---------- */
/* buildSteps ends in an unguarded stepsEspresso fallback (gap G4b). Until that is made explicit,
   pin the set of drinks allowed to reach it, so a future non-espresso drink cannot land there silently. */
const ESPRESSO_FALLBACK_ALLOWED = new Set([
  "ristretto", "espresso-solo", "doppio", "lungo", "americano", "cortado", "macchiato",
  "piccolo-latte", "flat-white", "cappuccino", "latte", "mocha", "affogato",
  "espresso-con-panna", "vienna", "iced-americano", "iced-latte",
]);
const EXPLICIT_IDS = new Set(["long-black", "turkish-coffee", "bosnian", "vietnamese", "greek-frappe", "cortadito", "cafe-au-lait", "cold-brew"]);
const FILTER_VESSELS = new Set(["v60", "chemex", "frenchpress", "aeropress", "mokapot", "drip"]);
for (const [cat, d] of pairs) {
  const routed = EXPLICIT_IDS.has(d.id) || (cat.id === "filter" && FILTER_VESSELS.has(d.vessel));
  if (!routed && !ESPRESSO_FALLBACK_ALLOWED.has(d.id)) {
    fail("I6", `drink "${d.id}" reaches the stepsEspresso catch-all without being declared an espresso drink. Either give it its own generator or add it to ESPRESSO_FALLBACK_ALLOWED in this gate.`);
  }
}

/* ---------- I7 ratio label matches its own numbers (filter methods) ---------- */
/* Exempt, by name and with reason: the espresso family divides a gram dose by a millilitre yield,
   so its `ratio` is not arithmetically checkable until gap G1 introduces a real gravimetric field. */
const RATIO_EXEMPT = new Set([...ESPRESSO_FALLBACK_ALLOWED, "long-black", "cold-brew", "cortadito", "greek-frappe", "vietnamese", "cafe-au-lait"]);
const doseGrams = (s) => { const m = /^([\d.]+)\s*g$/.exec(String(s).trim()); return m ? parseFloat(m[1]) : null; };
const waterMl = (d) => (d.layers ?? []).filter((l) => l[0] === "water").reduce((a, l) => a + l[1], 0);

let ratioChecked = 0;
for (const d of drinks) {
  if (RATIO_EXEMPT.has(d.id)) continue;
  if (!/^\d+(\.\d+)?(:\d+(\.\d+)?){1,2}$/.test(String(d.ratio))) {
    fail("I7", `drink "${d.id}" has a malformed ratio "${d.ratio}"`); continue;
  }
  const parts = String(d.ratio).split(":");
  if (parts.length !== 2) continue; // 1:1:1 style builds are not a dose:water ratio
  const g = doseGrams(d.dose), w = waterMl(d);
  if (g === null || w === 0) continue;
  ratioChecked++;
  const actual = w / g;
  const stated = parseFloat(parts[1]) / parseFloat(parts[0]);
  if (Math.abs(actual - stated) > 0.5) {
    fail("I7", `drink "${d.id}" states ratio ${d.ratio} but ${d.dose} to ${w}ml is 1:${actual.toFixed(1)}`);
  }
}
if (ratioChecked === 0) {
  fail("I7", "the ratio check matched zero drinks — its selectors are stale. A check that scans nothing is a failure, not a pass.");
}

/* ---------- I8 in-page navigation resolves ---------- */
/* Sections get their id from cat.id (index.html:1298), so a renamed category silently orphans the
   nav link that pointed at it. Both directions are checked: no dangling link, no unreachable section. */
const navHrefs = [...html.matchAll(/href="#([a-z0-9-]+)"/g)].map((m) => m[1]);
const catIds = new Set(CATEGORIES.map((c) => c.id));
if (navHrefs.length === 0) {
  fail("I8", "found no in-page nav links to check — the selector is stale. Scanning nothing is a failure, not a pass.");
}
for (const href of new Set(navHrefs)) {
  if (!catIds.has(href)) fail("I8", `nav links to "#${href}" but no category has that id, so the link goes nowhere`);
}
for (const id of catIds) {
  if (!navHrefs.includes(id)) fail("I8", `category "${id}" renders a section but nothing in the nav links to it`);
}

/* ---------- report ---------- */
console.log(`checked ${drinks.length} drinks across ${CATEGORIES.length} categories · steps rendered in 2 languages · ${ratioChecked} ratios verified arithmetically`);
if (failures.length) {
  console.error(`\n${failures.length} invariant violation(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("all dataset invariants hold");
