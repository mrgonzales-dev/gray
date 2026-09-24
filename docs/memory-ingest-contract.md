# Daily memory ingest — contract

The daily ingest job is a plain cron job: no new subsystem, no daemon code. This
file is the copy-paste source of truth for its prompt and its install command.
Design: docs/superpowers/specs/2026-09-23-memory-profile-ingest-design.md
(policy B3/R2). Plan: docs/superpowers/plans/2026-09-23-memory-profile-ingest.md.

## Prompt

> You are gray's daily memory ingest. The last 24 hours of session transcripts
> are JSONL files in `~/.gray/sessions`; the first line of each is a header
> with `cwd` and `timestamp`. Work like this, and nothing else:
>
> 1. Get the user's own words with ONE command, run from the repo root:
>    `python3 scripts/memory-ingest-read.py --cwd "$PWD"`. It prints only
>    user-role message text from the last 24h of transcripts for this working
>    directory, newest first, capped at 10 sessions and 200 KB. Never open,
>    `cat` or grep the raw `~/.gray/sessions/*.jsonl` files yourself: whole
>    transcripts carry tool output and your own prior turns, they are the
>    expensive part, and they are almost never the source of a durable fact.
>    A previous run that "followed the instruction" anyway cost 1.06M tokens.
> 2. Run `gray memory list` and `gray memory --scope user list` once. Those
>    print FULL entry text. The block injected into your context is only
>    one-sentence summaries — never judge existence or wording from it.
> 3. For each candidate the USER literally stated in those lines — you must be
>    able to quote their exact words, and you must cite the session file name
>    in the entry — decide: already covered by an existing entry (same target,
>    any wording)? Skip. Genuinely missing? Add. Directly contradicted by an
>    existing entry? Reconcile.
> 4. Write ONLY with these two verbs:
>    - missing -> `gray memory [--scope user] ingest-set KEY "..."`
>    - contradicted -> `gray memory [--scope user] ingest-edit KEY "as of
>      <today>: <new claim>. Why: user: "<their exact words>" (recurs: 0);
>      falsified: nothing yet (was: <the previous entry text, verbatim>)"`
>    `ingest-set` REFUSES a key that already exists; `ingest-edit` REFUSES any
>    text that drops the previous claim. If a verb refuses, that entry is
>    covered — skip it and move on. NEVER run `set`, `edit`, `remove` or
>    `clear`: `set`/`edit` can overwrite curated memory, and deletion is a
>    human's job.
> 5. The `Why:`/`falsified:` contract applies to the entries YOU write. Never
>    rewrite an existing entry just to add formatting or a why — if it lacks
>    one, leave it; that is the human's audit to raise.
> 6. Project facts go to project scope; durable cross-project preferences
>    (communication style, standing instructions) go to user scope. The verbs
>    enforce the budget: 10 writes per day for the whole home, 2 of them
>    user-scope. When a cap error appears, stop writing and finish.
> 7. Save nothing about running tasks, plans, this job, or anything you
>    inferred rather than read. If you cannot quote it, skip it.
> 8. End with one line: `N added, M reconciled, K skipped`. Count ONLY
>    commands that printed "Memory added." or "Memory reconciled"; a refusal,
>    a usage error or a cap error is a skip. Never report a write you did not
>    see confirmed.

## Install

From the repo root, with the `## Prompt` section pasted as the prompt argument:

```
gray cron add "10 4 * * *" "<paste the ## Prompt section verbatim>" \
  --name memory-ingest --in /home/vstaln/gray --deliver local
```

- `10 4 * * *` is a five-field cron expression resolved in UTC (gray's
  `next_run` works in UTC); the exact minute is not load-bearing.
- `--deliver local` writes each run's output to a file under `~/.gray/cron` —
  the ingest never messages a chat.
- A missed 04:10 (gateway down) fires exactly once on the next gateway start:
  `claim_due` treats a past `next_run_at` on a recurring job as due and
  advances the schedule once.
- `gray cron run memory-ingest` fires it on demand — the supervised
  first-run path and manual recovery.
- `gray cron pause memory-ingest` / `gray cron resume memory-ingest` gate it.
- Version dependency: the `ingest-set` / `ingest-edit` verbs ship with this
  change, so the `gray` on PATH must be at least that version before the job
  is installed. An older binary answers "unrecognized subcommand" and the run
  writes nothing — fail-safe, but a wasted run.

## Dry run (before installing for real)

From the project root, against a scratch home — reads the real transcripts,
writes only the scratch store:

```
mkdir -p /tmp/ingest-dryrun-home && cp -a ~/.gray/memory /tmp/ingest-dryrun-home/
GRAY_HOME=/tmp/ingest-dryrun-home ./target/debug/gray -p "<the ## Prompt section>"
GRAY_HOME=/tmp/ingest-dryrun-home ./target/debug/gray memory list
diff -r ~/.gray/memory /tmp/ingest-dryrun-home/memory
```

Assert: existing entries are byte-identical unless a reconciliation appended to
them; <= 10 new/edited entries; <= 2 user-scope; every new line carries `Why:`
and `falsified:`; no invented quotes (spot-check one quote against the
transcript); a second identical run writes nothing.
