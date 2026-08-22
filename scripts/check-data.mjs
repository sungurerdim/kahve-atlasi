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
/* buildSteps falls back to stepsEspresso for anything it does not route. That is correct only for
   drinks that really are espresso builds. The routed set is read from the page's own STEP_ROUTES and
   FILTER_STEPS tables rather than restated here, so this check cannot drift from the code it guards. */
const ESPRESSO_CATEGORIES = new Set(["espresso", "cold"]);
const routes = sandbox.STEP_ROUTES ?? {};
const filterSteps = sandbox.FILTER_STEPS ?? {};
if (Object.keys(routes).length === 0 || Object.keys(filterSteps).length === 0) {
  fail("I6", "STEP_ROUTES or FILTER_STEPS is missing from the page — this check derives the routed set from them, so it cannot verify anything.");
}
for (const [cat, d] of pairs) {
  const routed = Object.prototype.hasOwnProperty.call(routes, d.id) ||
    (cat.id === "filter" && Object.prototype.hasOwnProperty.call(filterSteps, d.vessel));
  if (!routed && !ESPRESSO_CATEGORIES.has(cat.id)) {
    fail("I6", `drink "${d.id}" sits in category "${cat.id}" and is not in STEP_ROUTES, so it silently falls back to espresso instructions. Give it a generator and route it.`);
  }
}

/* ---------- I7 ratio label matches its own numbers ---------- */
/* The scope is derived from the data's own semantics rather than a name list: a ratio is only
   arithmetically checkable when the record itself says the two sides are coffee and water. Espresso
   builds (dose in grams against a yield in millilitres, gap G1) and milk or spirit builds declare a
   different ratioLabel and are therefore out of scope by construction, not by exemption. */
const COFFEE_WATER = "coffee : water";
const doseGrams = (s) => { const m = /^([\d.]+)\s*g$/.exec(String(s).trim()); return m ? parseFloat(m[1]) : null; };
const waterMl = (d) => (d.layers ?? []).filter((l) => l[0] === "water").reduce((a, l) => a + l[1], 0);

let ratioChecked = 0;
for (const d of drinks) {
  // "—" is the declared "this drink has no meaningful ratio" value, the same marker I2 honours and
  // that ingredientRows() suppresses the row for. Nothing to check arithmetically.
  if (d.ratio === "—") continue;
  if (!/^\d+(\.\d+)?(:\d+(\.\d+)?){1,2}$/.test(String(d.ratio))) {
    fail("I7", `drink "${d.id}" has a malformed ratio "${d.ratio}"`); continue;
  }
  if (d.ratioLabel?.en !== COFFEE_WATER) continue;
  const parts = String(d.ratio).split(":");
  if (parts.length !== 2) { fail("I7", `drink "${d.id}" labels its ratio "${COFFEE_WATER}" but states ${d.ratio}, which is not two-sided`); continue; }
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

/* ---------- I9 every layer key has a colour and a label ---------- */
/* Layer swatches are built as var(--l-<key>) (index.html:613 and :1117). A key with no matching CSS
   variable is not a fallback — the SVG fill resolves to black and the legend dot loses its colour. */
const cssVars = new Set([...html.matchAll(/--l-([a-z]+)\s*:/g)].map((m) => m[1]));
const layerKeys = new Set(drinks.flatMap((d) => (d.layers ?? []).map((l) => l[0])));
if (layerKeys.size === 0) {
  fail("I9", "found no layer keys to check — the selector is stale. Scanning nothing is a failure, not a pass.");
}
for (const key of layerKeys) {
  if (!cssVars.has(key)) fail("I9", `layer "${key}" has no --l-${key} colour, so its swatch renders black instead`);
  if (!sandbox.LAYER_LABELS?.[key]) fail("I9", `layer "${key}" has no entry in LAYER_LABELS, so its row renders unlabelled`);
}

/* ---------- I10 every vessel a drink uses is nameable and drawable ---------- */
/* The detail panel prints t(VESSEL_NAMES[d.vessel]) (index.html:1299). A vessel with no entry there
   leaves the "served in" row blank, and one with no geometry cannot be drawn at all. */
const vesselNames = sandbox.VESSEL_NAMES ?? {};
if (Object.keys(vesselNames).length === 0) {
  fail("I10", "VESSEL_NAMES is missing from the page — this check derives from it, so it cannot verify anything.");
}
for (const vessel of new Set(drinks.map((d) => d.vessel))) {
  if (!vesselNames[vessel]) fail("I10", `vessel "${vessel}" has no VESSEL_NAMES entry, so its "served in" row renders blank`);
}

/* ---------- I11 the gravimetric brew ratio is well formed and explained ---------- */
/* Espresso drinks carry two figures: `ratio` is the traditional volume in the cup, `brewRatio` is
   the specialty dose-to-yield ratio by weight. Carrying one without its label reintroduces exactly
   the ambiguity the pair exists to remove. */
for (const d of drinks) {
  if (d.brewRatio === undefined) continue;
  if (!/^\d+(\.\d+)?:\d+(\.\d+)?$/.test(String(d.brewRatio))) {
    fail("I11", `drink "${d.id}" has a malformed brewRatio "${d.brewRatio}"`);
  }
  if (!bothLangs(d.brewRatioLabel)) {
    fail("I11", `drink "${d.id}" states a brewRatio but has no complete {tr, en} brewRatioLabel, so the number renders unexplained`);
  }
}

/* ---------- report ---------- */
console.log(`checked ${drinks.length} drinks across ${CATEGORIES.length} categories · steps rendered in 2 languages · ${ratioChecked} ratios verified arithmetically`);
if (failures.length) {
  console.error(`\n${failures.length} invariant violation(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("all dataset invariants hold");
