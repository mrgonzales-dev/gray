#!/usr/bin/env node
// Aggregate typesafe scan results into SIMPLIFY_REPORT.md
// Usage: node typesafe_report.mjs [results.jsonl] [out.md]
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const file = process.argv[2] ?? "typesafe_results.jsonl";
const outFile = process.argv[3] ?? "SIMPLIFY_REPORT.md";
const rows = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const crateOf = (p) => (p.match(/^crates\/([^/]+)\//) ?? [])[1] ?? p;
const linesOf = (r) => r.lines[1] - r.lines[0] + 1;
const signals = ["yagni", "nearby_duplicate", "stdlib_replacement", "lazy_violation"];
// lazy_violation is inverted: high means "hard-line content present, do not cut blindly".

// strong = noul >= 0.75, moderate = >= 0.6
const strong = (r, s) => r[s] >= 0.75;
const mod = (r, s) => r[s] >= 0.6 && r[s] < 0.75;

// ---------- overview ----------
const tokIn = rows.reduce((a, r) => a + (r.usage?.input_tokens ?? 0), 0);
const files = new Set(rows.map((r) => r.path));
const src = rows.filter((r) => r.kind === "src");
const tst = rows.filter((r) => r.kind === "test");
const p1 = (x) => x.toFixed(2);

const out = [];
out.push(`# Gray codebase simplification report`);
out.push("");
out.push(`Judged by TypeSafe Jev (\`jev-1.13.0\`): ${rows.length} chunks across ${files.size} Rust files ` +
  `(${src.length} source, ${tst.length} test). ${tokIn.toLocaleString()} input tokens.`);
out.push("");
out.push(`Each chunk got 6 independent judgments on the ponytail ladder: YAGNI (should it exist), ` +
  `nearby duplication (reuse), std replacement, a lazy-violation guard (hard-line content), a 0-4 shrink-fraction ` +
  `score, and the single laziest move.`);
out.push("");

// ---------- systemic signals ----------
out.push(`## Systemic signals (source code)`);
out.push("");
out.push(`| Signal | strong (>=0.75) | moderate (0.6-0.75) | mean noul |`);
out.push(`|---|---|---|---|`);
for (const s of signals) {
  const note = s === "lazy_violation" ? " (high = guarded, don't cut blindly)" : "";
  out.push(`| ${s}${note} | ${src.filter((r) => strong(r, s)).length} chunks | ${src.filter((r) => mod(r, s)).length} chunks | ${p1(avg(src.map((r) => r[s])))} |`);
}
out.push("");

// laziest_move distribution among high-value source chunks (score >= 2)
const hot = src.filter((r) => r.shrink_fraction >= 2);
out.push(`### Laziest-move distribution for source chunks scored >= 2 (${hot.length} chunks)`);
out.push("");
const moves = {};
for (const r of hot) moves[r.laziest_move] = (moves[r.laziest_move] ?? 0) + 1;
for (const [m, n] of Object.entries(moves).sort((a, b) => b[1] - a[1])) {
  out.push(`- **${m}**: ${n} chunks`);
}
out.push("");

// ---------- drill-down (second-pass concrete characterization) ----------
const drillFile = process.env.DRILL_FILE ?? "typesafe_drill_results.jsonl";
if (existsSync(drillFile)) {
  const drills = readFileSync(drillFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  out.push(`## Drill-down on top chunks (second Jev pass, ponytail lens)`);
  out.push("");
  out.push(`| Location | Dominant bloat (conf) | One-helper payoff | Deletable present | Guard content | Focused shrink |`);
  out.push(`|---|---|---|---|---|---|`);
  for (const d of drills.sort((a, b) => b.focused_shrink - a.focused_shrink)) {
    const p = (x) => (typeof x === "number" ? x.toFixed(2) : String(x));
    out.push(
      `| \`${d.path}\` ${d.lines[0]}-${d.lines[1]} | ${d.bloat_kind} (${p(d.bloat_conf)}) | ${p(d.one_helper_payoff)} | ${p(d.deletable)} | ${p(d.guard_content)} | ${p(d.focused_shrink)}/4 |`,
    );
  }
  out.push("");
  out.push(`*One-helper payoff*: probability one new helper with >=3 call sites removes >=10% of the chunk. `);
  out.push(`*Deletable present*: probability unused/speculative code exists here. *Guard content*: probability trust-boundary `);
  out.push(`validation, data-loss error handling, or security code is present (simplify around it). *Focused shrink*: 0-4 `);
  out.push(`fraction of the chunk the identified moves remove, behavior unchanged.`);
  out.push("");
}

// ---------- per-crate table ----------
out.push(`## By crate (source code)`);
out.push("");
out.push(`| Crate | chunks | mean shrink | mean chars/chunk | strong (yagni/dup/std/guard) |`);
out.push(`|---|---|---|---|---|`);
const crates = {};
for (const r of src) (crates[crateOf(r.path)] ??= []).push(r);
for (const [c, rs] of Object.entries(crates).sort((a, b) => avg(b[1].map((r) => r.shrink_fraction)) - avg(a[1].map((r) => r.shrink_fraction)))) {
  const sc = (s) => rs.filter((r) => strong(r, s)).length;
  out.push(`| ${c} | ${rs.length} | ${p1(avg(rs.map((r) => r.shrink_fraction)))} | ${Math.round(avg(rs.map((r) => r.chars)))} | ${sc("yagni")}/${sc("nearby_duplicate")}/${sc("stdlib_replacement")}/${sc("lazy_violation")} |`);
}
out.push("");

// ---------- top findings ----------
function topSection(name, pool, n) {
  const top = [...pool].sort((a, b) => b.shrink_fraction - a.shrink_fraction ||
    (b.confidence?.shrink_fraction ?? 0) - (a.confidence?.shrink_fraction ?? 0)).slice(0, n);
  out.push(`## Top ${top.length} ${name} chunks by shrink fraction (ponytail)`);
  out.push("");
  out.push(`| Shrink | Conf | Location | Lines | Signals | Laziest move |`);
  out.push(`|---|---|---|---|---|---|`);
  for (const r of top) {
    const sig = signals.filter((s) => strong(r, s)).map((s) => s.replace("_", " ")).join(", ") || "—";
    out.push(`| ${p1(r.shrink_fraction)} | ${p1(r.confidence?.shrink_fraction ?? 0)} | \`${r.path}\` | ${r.lines[0]}-${r.lines[1]} | ${sig} | ${r.laziest_move} |`);
  }
  out.push("");
}
topSection("source-code", src, 30);
if (tst.length) topSection("test-code", tst, 15);

// ---------- file-level priorities ----------
out.push(`## File-level priorities (source)`);
out.push("");
out.push(`Files ranked by weighted shrink: mean chunk score × chunk size (a proxy for total code removable).`);
out.push("");
out.push(`| File | mean score | lines scanned | weighted |`);
out.push(`|---|---|---|---|`);
const byFile = {};
for (const r of src) (byFile[r.path] ??= []).push(r);
const fileRank = Object.entries(byFile)
  .map(([p, rs]) => ({ p, mean: avg(rs.map((r) => r.shrink_fraction)), lines: rs.reduce((a, r) => a + linesOf(r), 0) }))
  .map((f) => ({ ...f, w: f.mean * f.lines }))
  .sort((a, b) => b.w - a.w)
  .slice(0, 20);
for (const f of fileRank) out.push(`| \`${f.p}\` | ${p1(f.mean)} | ${f.lines} | ${Math.round(f.w)} |`);
out.push("");

// ---------- methodology ----------
out.push(`## Method & caveats`);
out.push("");
out.push(`- Model: \`jev-latest\` → jev-1.13.0, one batched request per ~450-line chunk (all 6 questions see the same state).`);
out.push(`- Noul values are probabilities (0=no, 1=yes); >= 0.75 counted as a strong signal, not proof.`);
out.push(`- lazy_violation is a guard: high values mark trust-boundary validation, data-loss error handling, or security code. Simplify around it, not through it.`);
out.push(`- Score confidence summarizes how concentrated the rating distribution is; use it to triage, not as ground truth.`);
out.push(`- Chunks cut at ~450 lines on brace/blank boundaries, so findings are local, not whole-file design verdicts.`);
out.push(`- Raw judgments kept in \`${file}\` for re-aggregation with different thresholds.`);
out.push("");

writeFileSync(outFile, out.join("\n"));
console.log(`Wrote ${outFile}`);
console.log(`rows=${rows.length} src=${src.length} test=${tst.length} hot_src(score>=2)=${hot.length}`);
