#!/usr/bin/env node
// TypeSafe System One scan of the gray codebase for simplification opportunities.
// Usage: TYPESAFE_API_KEY=... node typesafe_scan.mjs [paths...] [--out FILE]
// Docs: https://docs.typesafe.ai/api.md

import { readFileSync, writeFileSync, existsSync, appendFileSync, statSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const API = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";
const KEY = process.env.TYPESAFE_API_KEY;
if (!KEY) {
  console.error("Set TYPESAFE_API_KEY");
  process.exit(1);
}

const argv = process.argv.slice(2);
const outIdx = argv.indexOf("--out");
const OUT = outIdx >= 0 ? argv[outIdx + 1] : "typesafe_results.jsonl";
const roots = argv.filter((a, i) => i !== outIdx && i !== outIdx + 1);
const scanRoots = roots.length ? roots : ["crates"];

const MAX_LINES = 450;
const MAX_CHARS = 48000;
const CONCURRENCY = 8;
const MAX_TRIES = 7;

// ---------- file discovery ----------
function walk(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.isFile() && e.name.endsWith(".rs")) acc.push(p);
  }
  return acc;
}
const files = scanRoots.flatMap((r) => (statSync(r).isFile() ? [r] : walk(r, []))).sort();
console.error(`Found ${files.length} Rust files under: ${scanRoots.join(", ")}`);

// ---------- chunking ----------
function chunkFile(path, text) {
  const lines = text.split("\n");
  const chunks = [];
  let start = 0; // 0-indexed
  while (start < lines.length) {
    if (lines.length - start <= MAX_LINES) {
      chunks.push([start, lines.length]);
      break;
    }
    let end = Math.min(start + MAX_LINES, lines.length);
    // prefer a clean break: closing brace or blank line, in the last 20% of the window
    const lo = start + Math.floor(MAX_LINES * 0.8);
    for (let i = end - 1; i >= lo; i--) {
      const t = lines[i].trimEnd();
      if (t === "}" || t === "") {
        end = i + 1;
        break;
      }
    }
    let slice = lines.slice(start, end).join("\n");
    while (slice.length > MAX_CHARS) {
      const back = Math.max(lo, end - Math.floor((end - start) * 0.2));
      end = back > start ? back : end - 100;
      slice = lines.slice(start, end).join("\n");
    }
    chunks.push([start, end]);
    start = end;
  }
  return chunks;
}

// ---------- questions (all independent -> one batched call per chunk) ----------
// Anchored to the ponytail ladder: YAGNI -> reuse-in-codebase -> std -> one-liner.
const questions = {
  yagni: {
    type: "noul",
    instructions:
      "Does part of this code not need to exist: speculative generality, abstractions with one implementation, config knobs for values that never change, or features no caller uses?",
    criteria: {
      true: "Yes, something here could be deleted outright with no loss of behavior",
      false: "Everything here earns its keep",
    },
  },
  nearby_duplicate: {
    type: "noul",
    instructions:
      "Does this code re-implement logic that already exists elsewhere in this codebase, or contain a block repeated within itself (near-identical names, literals, structure), that one shared helper would replace?",
    criteria: {
      true: "Yes, a shared helper (existing or one new) would replace repeated or re-implemented logic",
      false: "No meaningful re-implementation or internal repetition",
    },
  },
  stdlib_replacement: {
    type: "noul",
    instructions:
      "Does this code hand-roll something the Rust std, the platform, or an already-declared dependency already provides (iterator combinators, path/string ops, serde, diff helpers)?",
    criteria: {
      true: "Yes, at least one hand-rolled piece has a direct off-the-shelf replacement",
      false: "No, nothing here reimplements available functionality",
    },
  },
  lazy_violation: {
    type: "noul",
    instructions:
      "If this code were simplified as aggressively as a lazy refactor would dare, would it cut something that must NOT be cut: input validation at a trust boundary, error handling that prevents data loss, or security checks?",
    criteria: {
      true: "Yes, simplification here would cross a hard line",
      false: "No hard-line content; simplification is safe from that perspective",
    },
  },
  shrink_fraction: {
    type: "score",
    instructions:
      "Written the laziest correct way (delete, reuse, std, one-liners), what fraction of this code's lines could disappear with behavior unchanged?",
    criteria: [
      "Under 5%: already minimal",
      "5-25%: modest trims",
      "25-50%: substantial reduction available",
      "50-75%: most of it is scaffolding around little content",
      "Over 75%: nearly all of it duplicates or wraps something that exists",
    ],
  },
  laziest_move: {
    type: "choice",
    instructions:
      "Which single laziest move shrinks this code most while keeping behavior identical?",
    criteria: {
      delete_it: "Delete code that is unused or speculative; nothing else needs to change",
      reuse_existing: "Call the helper/type that already exists in this codebase instead of re-implementing it",
      swap_to_std: "Replace hand-rolled logic with a std/platform/dependency function",
      collapse_to_one_liner: "Rewrite verbose blocks as 1-3 lines using iterators, ?, or existing helpers",
      flatten_to_data: "Replace branching logic with a table/data-driven lookup",
      extract_one_helper: "Extract exactly one shared helper to kill the repetition",
      already_lazy: "This is already the laziest correct form",
    },
  },
};

// ---------- resume support ----------
const done = new Set();
if (existsSync(OUT)) {
  for (const line of readFileSync(OUT, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      done.add(JSON.parse(line).key);
    } catch {}
  }
  console.error(`Resuming: ${done.size} chunks already scanned in ${OUT}`);
}

// ---------- API call with retry/backoff ----------
async function ask(state) {
  const body = JSON.stringify({ state, model: MODEL, questions });
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body,
      });
      if (res.ok) {
        const json = await res.json();
        return { answers: json.answers, usage: json.usage };
      }
      if ([429, 529, 500, 502, 503, 504].includes(res.status)) {
        const retryAfter = Number(res.headers.get("retry-after")) || 0;
        const wait = Math.max(retryAfter, Math.min(30, 0.5 * 2 ** (attempt - 1)));
        if (attempt === MAX_TRIES) throw new Error(`HTTP ${res.status} after ${MAX_TRIES} tries`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    } catch (e) {
      if (e.cause || /fetch failed/.test(String(e))) {
        await new Promise((r) => setTimeout(r, Math.min(30, 0.5 * 2 ** (attempt - 1)) * 1000));
        if (attempt === MAX_TRIES) throw e;
        continue;
      }
      throw e;
    }
  }
}

// ---------- main ----------
const jobs = [];
for (const path of files) {
  const rel = relative(process.cwd(), path).split(sep).join("/");
  const text = readFileSync(path, "utf8");
  for (const [s, e] of chunkFile(path, text)) {
    const key = `${rel}:${s + 1}-${e}`;
    if (!done.has(key)) jobs.push({ key, rel, s, e, text: text.split("\n").slice(s, e).join("\n") });
  }
}
console.error(`${jobs.length} chunks to scan (${done.size} already done)`);

const isTest = (rel) => /(^|\/)(tests?\/|.*_tests\.rs|testdata\/)/.test(rel) || /_tests?\.rs$/.test(rel);
let inFlight = 0, next = 0, failures = 0;
const t0 = Date.now();
let totalIn = 0, totalOut = 0;

function pump() {
  if (next >= jobs.length && inFlight === 0) return;
  while (inFlight < CONCURRENCY && next < jobs.length) {
    const job = jobs[next++];
    inFlight++;
    const state = {
      path: job.rel,
      kind: isTest(job.rel) ? "test code" : "source code",
      lines: `${job.s + 1}-${job.e}`,
      code: job.text,
    };
    ask(state)
      .then(({ answers, usage }) => {
        const rec = {
          key: job.key,
          path: job.rel,
          lines: [job.s + 1, job.e],
          kind: isTest(job.rel) ? "test" : "src",
          chars: job.text.length,
          ...Object.fromEntries(
            Object.entries(answers).map(([k, a]) => [
              k,
              a.type === "noul" ? a.noul : a.type === "score" ? a.score : a.choice,
            ]),
          ),
          confidence: Object.fromEntries(
            Object.entries(answers).map(([k, a]) => [k, a.confidence ?? null]),
          ),
          usage,
        };
        appendFileSync(OUT, JSON.stringify(rec) + "\n");
        totalIn += usage?.input_tokens ?? 0;
        totalOut += usage?.output_tokens ?? 0;
        const p = (x) => (typeof x === "number" ? x.toFixed(2) : x);
        console.log(
          `${job.rel}:${job.s + 1}-${job.e} shrink=${p(rec.shrink_fraction)} conf=${p(rec.confidence.shrink_fraction)} yagni=${p(rec.yagni)} dup=${p(rec.nearby_duplicate)} std=${p(rec.stdlib_replacement)} guard=${p(rec.lazy_violation)} move=${rec.laziest_move}`,
        );
      })
      .catch((e) => {
        failures++;
        console.error(`FAIL ${job.key}: ${e.message}`);
      })
      .finally(() => {
        inFlight--;
        pump();
      });
  }
}
pump();

const timer = setInterval(() => {
  if (next >= jobs.length && inFlight === 0) {
    clearInterval(timer);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(
      `\nDone: ${jobs.length} chunks, ${failures} failures, in=${totalIn} tok, out=${totalOut} tok, ${secs}s. Results in ${OUT}`,
    );
  }
}, 250);
