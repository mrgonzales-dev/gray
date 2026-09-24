# Memory profile injection + daily ingest — design

Date: 2026-09-23. Status: draft for review. No code written yet.

## Context

The Instinct teardown (supermemory.ai, 2026-09-20) describes a memory system whose
whole bet is: small always-injected profile, everything else found on demand by
grep, and a daily background process that reconciles what is on disk. Gray already
has the durable store, the provenance trailers, the keep/delete audit, the panel,
and a cron ticker that could host the background pass. What it does not have is
the tradeoff itself: the full text of every entry is injected into every turn.

Measured on this box, 2026-09-23, for `/home/vstaln/gray`:

- project store: 25 entries, 23.5 KB on disk; served text 20.6 KB (~5-6k tokens)
  appended to the system prompt on every turn of every session in the repo
- `user.md`: 6 entries, 1.5 KB
- the prompt policy already tells the model to run `gray memory list` /
  `gray memory show KEY` — the fetch half exists; nothing forces it to be used
  because the whole store is already in context

A one-time prune (done separately, backed up at
`~/.gray/memory-backup-2026-09-23-prune`) cut the project store from 27 entries /
31.7 KB to 25 / 23.5 KB by deleting two superseded entries, compressing five
run-logs down to their why/falsified lines, and relocating four paper studies to
`docs/studies/` behind one-line pointers. That prune is a data operation, not
part of this feature.

## Goals

1. Cut the always-injected memory block by ~90% without losing recall: inject one
   sentence per entry, fetch full text on demand.
2. Add daily unattended ingestion so durable facts, decisions and preferences
   land in memory even when nobody remembers to save them.
3. Ruin nothing: byte-compatible store format, unchanged snapshot-freeze
   semantics, unchanged audit/panel/CLI, no new dependencies, no migration, and a
   one-key way back to today's exact bytes.

## Non-goals

- Vectors, embeddings, or any hosted memory service (supermemory et al.). Gray's
  grep-over-text surface is the retrieval layer.
- Instinct's typed folders, `aliases:` front-matter, or `[[wikilinks]]`. The flat
  keyed store already greps; a migration buys nothing today.
- A generated profile one-pager (an LLM writing the text you read every turn can
  go stale or wrong; the deterministic one-liner cannot).
- Automatic deletion or decay. Deletion stays a human act.
- A proposals UI in `/memory` (rejected in favour of direct add/edit writes).

## Decisions

| # | Decision | Chosen | Rejected |
|---|----------|--------|----------|
| A | Injected block | A1 deterministic one-sentence summaries, fetched on demand | A2 daily generated one-pager; A3 A1 + manual refresh |
| B | Ingest write policy | B3 direct writes, add/edit only, never remove | B1 direct incl. remove; B2 propose-then-approve UI |
| R | Ingest read scope | R2 project transcripts -> project scope, plus a bounded user-scope pass for cross-project preferences | R1 project-only; R3 everything -> user |
| — | Schedule | daily 04:10 (`10 4 * * *`, resolved in UTC; the minute is not load-bearing) | every 6h; on idle |
| — | Conflict | edit to `as of <date>: <new> (was: <old>)`, both kept | new `key-v2` entry; overwrite |
| — | Failure | error or zero writes -> nothing written, one status line, no retry beyond cron's catch-up | retry once on empty |

## Design A — one-sentence profile injection

### Data flow

`MemoryStore::snapshot()` (crates/gray/src/memory.rs:188) currently serializes
`self.list(scope)` — every entry's full text — into the `user` / `decisions`
fields of the snapshot JSON. `system_prompt::with_memory`
(crates/gray/src/system_prompt.rs:54) appends that JSON verbatim to the system
prompt. Snapshot bytes are frozen per durable session, so edits mid-session
never churn the prompt prefix.

The change: the two fields carry summaries instead of full text.

### First-sentence rule

New `MemoryStore::profile(scope) -> String` alongside `list()`:

- render exactly like `render_served` (same `- key: value` lines, same BTreeMap
  order, trailers already stripped) but each value is reduced to its first
  sentence;
- a sentence ends at the first `". "` whose preceding token is at least 2
  characters long — so `e.g. `, `i.e. `, `v1.3 ` and `3.5 ` never cut a
  sentence, while `... broke. Then ...` does;
- a value with no such boundary is served whole;
- no truncation, ever: a summary is a real sentence, not a clipped fragment. If
  a first sentence is genuinely huge, the fix is rewriting the entry, which the
  growth warning already nags about.

`snapshot()` calls `profile()` for both fields. Field names, JSON shape,
project-name check, `parse()` validation of snapshot contents, and the
session-freeze behaviour are unchanged.

### The escape hatch

`Config` (crates/gray/src/config.rs:36) gains:

```
memory_injection: "summary" | "full"     # default "summary"
```

`"full"` restores byte-identical today's behaviour (`list()` instead of
`profile()`). It exists because the point of this feature is that the cheap
revert is one key in `~/.gray/config.json`, not a revert commit.

### The prompt line

`MEMORY_POLICY` in system_prompt.rs already names `gray memory show KEY`. One
sentence is added to that existing passage, not a new paragraph:

> The injected block holds one-sentence summaries; `gray memory show KEY`
> prints an entry in full — fetch it before relying on a remembered decision.

No new tool, no new CLI verb. `gray memory list` still prints full text, so
`cat`/grep over it keeps working for the model.

### Cache behaviour

New sessions get the shorter block; durable sessions keep their frozen
snapshot. `prompt_cache_key = session_id` is untouched. Flipping the toggle
changes the prefix of new sessions only, which is the same class of change as
any compaction-policy edit.

## Design B — daily ingest job

### The job

A plain cron job — no new subsystem. Created with the existing CLI:

```
gray cron add "10 4 * * *" "<contract prompt below>" \
  --name memory-ingest --in /home/vstaln/gray --deliver local
```

- `deliver local` writes the run's output to a file under `~/.gray/cron` — the
  ingest never messages a chat.
- The turn runs with the gateway's configured model in `/home/vstaln/gray`, so
  `GRAY_SESSION_ID` is the cron session and provenance trailers read
  `source=<cron session id>` like any other save.
- A missed 04:10 (gateway down) fires exactly once on the next gateway start:
  `claim_due` treats a past `next_run_at` on a recurring job as due and advances
  the schedule once. No storm, no duplicate catch-ups.
- `gray cron run memory-ingest` fires it on demand — the manual recovery and
  first-run path (the dry run itself is the headless one-shot in Rollout).

### The contract prompt (verbatim, the load-bearing artifact)

> You are gray's daily memory ingest. The last 24 hours of session transcripts
> are JSONL files in `~/.gray/sessions`; the first line of each is a header
> with `cwd` and `timestamp`. Read only transcripts whose header `cwd` is
> `/home/vstaln/gray`, and at most the 100 newest (4 MB total). For each
> durable fact, decision, or preference THE USER stated — quote them; ignore
> your own actions, plans, tool output, and anything you merely inferred —
> decide whether it is missing from `gray memory list`, missing from
> `gray memory --scope user list`, or contradicts an existing entry.
> Missing -> `gray memory [--scope user] set KEY "..."`. Contradicts ->
> `gray memory [--scope user] edit KEY "as of <today>: <new> (was: <old>)"`,
> keeping both claims. NEVER run `remove` or `clear`: deletion is a human's
> job. Every entry must carry `Why:` (the user's quoted failure or correction
> that prompted it), whether that failure has recurred since, and
> `falsified:` (`nothing yet` if there is none). Project facts go to project
> scope; durable cross-project preferences (communication style, standing
> instructions) go to user scope, at most 2 per run. At most 10 writes per
> run. Save nothing about running tasks, plans, or this job itself. End with
> one line: `N set, M edited, K skipped`.

### Why the contract is NOT prompt-level (falsified by the dry run, 2026-09-23)

The first design enforced B3 in prose only. The scratch-home dry run falsified
it in one run: the job called `set` on six keys — `set` is add-or-replace — and
overwrote five curated user entries with degraded text, invented a new entry
whose `Why:` was a fabricated user quote ("i killed it because you were taking
too long"), and blew the two-write user-scope cap. It also spent 1.81M tokens
reading transcripts wholesale. Prompt-level promises are not mechanisms.

Enforcement therefore moved into the write path, as the spec's own deferral
anticipated ("deferred until the audit shows the prompt contract leaking"):

- `gray memory ingest-set KEY TEXT` — refuses an existing key (no overwrite
  path exists), requires `Why:` and `falsified:` tokens, spends from a hard
  daily budget of 10 writes per GRAY_HOME.
- `gray memory ingest-edit KEY TEXT` — append-only: the new text must contain
  the previous text verbatim (`as of <date>: <new> (was: <old>)`), so a
  contradiction is recorded, never silently replaced. Same tokens, same budget.
- User-scope writes are capped at 2/day. Counters live in
  `~/.gray/memory/.ingest-<date>.json` (0600); `remove`/`clear` are simply not
  part of the ingest surface, so the job cannot delete even if it tries.
- The contract (docs/memory-ingest-contract.md) additionally forbids
  `set`/`edit` by name, requires verbatim quotes with the session file cited,
  bounds reads to 10 transcripts' user lines / 200 KB, and applies the
  rationale format only to entries the job itself writes.

The store format, provenance, locks and the human `set`/`edit`/`remove` path are
unchanged; the guard is a separate surface for one specific caller.

### Bounds and edge cases

- Read cap: 100 sessions / 4 MB per run, newest first. Older transcripts are
  simply not seen; a backlog converges over several runs.
- Write cap: enforced in the write path, not the prompt — 10 per day per
  GRAY_HOME, 2 user-scope. A noisy day cannot flood the store even if the job
  ignores its instructions.
- Idempotence: writes are keyed, so a re-run with no new information performs
  zero writes and reports `0 set, 0 edited, K skipped`.
- Concurrency: `set`/`edit` take the same per-store lock interactive saves use;
  a run that collides with a live save retries at the CLI level, and the
  locked read-modify-write means one of the two writes is lost, never
  interleaved. The audit is the detector.
- Malformed transcripts: skipped lines, never a crash — the ingest reads with
  ordinary tools, not the strict session loader.
- Secrets: `validate_text` already refuses credential-shaped text; that check
  is unchanged and applies to ingest writes like any other.

### Rollout

1. Ship A with the toggle.
2. Dry-run B against a scratch home, headless, from the project root:
   `GRAY_HOME=<tmp> gray -p "<contract prompt>"`. `GRAY_HOME` is honoured via
   `setup::gray_home()`, so the run reads the real `~/.gray/sessions` (HOME is
   unchanged) but writes only into `<tmp>/memory`. Diff that store before and
   after; assert only `set`/`edit` happened, the write caps held, and a second
   identical run is a no-op.
3. Create the real job on this box (paused first, one manual `gray cron run`,
   then resume).

## What does not change

Store format (one `- key: value <!-- gray:... -->` line per entry), file modes
(0600 files, 0700 dirs), locking, provenance, snapshot freeze, `gray memory`
subcommands, `/memory` panel, `audit`, growth warning, `GRAY_NO_MEMORY=1`, the
cron subsystem, the provider stack. The 25 existing entries need no edits: their
first sentences are their summaries.

## Testing

Unit (crates/gray/src/memory_tests.rs, following the existing tempfile style):

- first-sentence extraction: plain sentence; no period (served whole);
  `e.g.`/`i.e.`/decimal inside a sentence; multi-sentence; unicode sentence
  end; empty-value rejection unchanged
- `profile()` output equals `list()` output when every entry is one sentence
- snapshot: `user`/`decisions` fields carry summaries; snapshot JSON shape,
  project check, and per-session freeze unchanged
- config: `memory_injection` defaults to `summary`; `"full"` reproduces the
  pre-change bytes exactly (golden compare against `list()`)
- schedule: `10 4 * * *` parses and `next_run` lands on 04:10 UTC
  (crates/gray/src/cron/schedule_tests.rs)

Integration (this box, after the unit suite is green):

- headless dry run from the project root: `GRAY_HOME=<tmp> gray -p "<contract
  prompt>"`. `GRAY_HOME` is honoured via `setup::gray_home()`, so the run reads
  the real `~/.gray/sessions` (HOME unchanged) but writes only into
  `<tmp>/memory`; assert: store parses, only set/edit occurred, the write caps
  held, and a second identical run is a no-op
- full `cargo fmt --check`, `cargo clippy --workspace -- -D warnings`,
  `cargo test --workspace` before commit (repo gates)

## Open questions

None. All choices above are settled; remaining unknowns (the `falsified:` audit
heuristic nagging on keeper entries, the stale `growth.json` streak after the
out-of-band prune) are known, recorded, and out of scope here.
