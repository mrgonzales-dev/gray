#!/usr/bin/env node
// Second-stage drill-down (ponytail lens): for the top-scored source chunks, ask Jev
// for concrete, typed characterizations of the laziest available cuts.
// Usage: TYPESAFE_API_KEY=... node typesafe_drill.mjs [results.jsonl] [out.jsonl]
import { readFileSync, appendFileSync, existsSync } from "node:fs";

const in_file = process.argv[2] ?? "typesafe_results.jsonl";
const out_file = process.argv[3] ?? "typesafe_drill_results.jsonl";
const KEY = process.env.TYPESAFE_API_KEY;
if (!KEY) { console.error("Set TYPESAFE_API_KEY"); process.exit(1); }

const rows = readFileSync(in_file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const TOP_N = Number(process.env.TOP_N ?? 12);

const top = rows
  .filter((r) => r.kind === "src")
  .sort((a, b) => b.shrink_fraction - a.shrink_fraction)
  .slice(0, TOP_N);

const questions = {
  bloat_kind: {
    type: "choice",
    instructions: {
      question: "Which kind of bloat dominates `code`? Pick the single largest source of avoidable code.",
    },
    criteria: {
      dispatch_chain: "Long match/if-else dispatch chains mapping inputs to handlers",
      repeated_block: "A >=15-line block repeated with only small differences (names, literals)",
      verbose_strings: "Verbose string/formatting assembly where short expressions would do",
      hand_rolled: "Hand-rolled logic std or an existing dependency already provides",
      speculative_generality: "Abstractions, config, or branches for cases that never occur",
      none_notable: "No sizable avoidable code in this chunk",
    },
  },
  one_helper_payoff: {
    type: "noul",
    instructions: "If exactly one helper function were extracted from `code`, would it have 3 or more call sites and shrink this chunk by at least ~10%?",
    criteria: { true: "Yes, one extraction reaches both bars", false: "No single extraction reaches that bar" },
  },
  deletable: {
    type: "noul",
    instructions: "Is there code in `code` that could simply be deleted: unused items, speculative branches, config for values that never change, leftover scaffolding?",
    criteria: { true: "Yes, at least one clearly deletable piece exists", false: "No, nothing here is deletable" },
  },
  guard_content: {
    type: "noul",
    instructions: "Does `code` contain content a lazy refactor must not cut: input validation at a trust boundary, error handling that prevents data loss, or security checks?",
    criteria: { true: "Yes, hard-line content is present; simplify around it", false: "No hard-line content" },
  },
  focused_shrink: {
    type: "score",
    instructions: "Fraction of `code` (by lines) removable by the specific laziest moves identified above, with behavior unchanged?",
    criteria: [
      "Under 5%: essentially nothing removable",
      "5-25%: modest trims",
      "25-50%: noticeable reduction",
      "50-75%: large reduction; scaffolding dominates",
      "Over 75%: nearly all of it duplicates or wraps something that exists",
    ],
  },
};

const done = new Set();
if (existsSync(out_file)) {
  for (const line of readFileSync(out_file, "utf8").split("\n")) {
    if (line.trim()) { try { done.add(JSON.parse(line).path + ":" + JSON.parse(line).lines.join("-")); } catch {} }
  }
}

(async () => {
  for (const r of top) {
    const k = `${r.path}:${r.lines.join("-")}`;
    if (done.has(k)) { console.log(`skip ${k}`); continue; }
    const text = readFileSync(r.path, "utf8").split("\n").slice(r.lines[0] - 1, r.lines[1]).join("\n");
    const state = { path: r.path, lines: `${r.lines[0]}-${r.lines[1]}`, code: text };
    let answers, usage, tries = 0;
    while (true) {
      try {
        const res = await fetch("https://api.typesafe.ai/v1/systemone", {
          method: "POST",
          headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ state, model: "jev-latest", questions }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text().then((t) => t.slice(0, 200))}`);
        ({ answers, usage } = await res.json());
        break;
      } catch (e) {
        if (++tries > 6) throw e;
        await new Promise((x) => setTimeout(x, Math.min(20, 0.5 * 2 ** tries) * 1000));
      }
    }
    const rec = {
      path: r.path, lines: r.lines, first_pass_shrink: r.shrink_fraction,
      bloat_kind: answers.bloat_kind.choice,
      bloat_conf: answers.bloat_kind.confidence,
      one_helper_payoff: answers.one_helper_payoff.noul,
      deletable: answers.deletable.noul,
      guard_content: answers.guard_content.noul,
      focused_shrink: answers.focused_shrink.score,
      usage,
    };
    appendFileSync(out_file, JSON.stringify(rec) + "\n");
    const p = (x) => (typeof x === "number" ? x.toFixed(2) : x);
    console.log(`${r.path}:${r.lines[0]}-${r.lines[1]} kind=${rec.bloat_kind}(${p(rec.bloat_conf)}) helper=${p(rec.one_helper_payoff)} del=${p(rec.deletable)} guard=${p(rec.guard_content)} shrink=${p(rec.focused_shrink)}`);
  }
})();
