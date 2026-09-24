# Memory profile injection + daily ingest — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inject one-sentence memory summaries instead of full entry text (with a `full` escape hatch), and stand up a daily cron job that adds/edits project + user memory from the last 24h of transcripts without ever deleting.

**Architecture:** Phase A adds `MemoryStore::profile()` (first-sentence render) and threads a `MemoryInjection` mode from saved config through `Config` into `snapshot()`; one line in `MEMORY_POLICY` tells the model to `gray memory show KEY` before relying on a remembered decision. Phase B ships no Rust: a verbatim ingest contract lives in `docs/memory-ingest-contract.md` and is installed as a plain cron job via the existing `gray cron add` CLI, verified by a headless dry run against a scratch `GRAY_HOME`.

**Tech Stack:** Rust (crates/gray), serde/serde_json, anyhow, existing tempfile-style unit tests, existing cron subsystem.

**Spec:** docs/superpowers/specs/2026-09-23-memory-profile-ingest-design.md — read it before Task 1; it argues the tradeoffs, the B3/R2 policy, and the guardrails.

## Global Constraints

- Shared working tree: a sibling session has uncommitted work in `crates/gray-plugin/**` and `crates/gray-provider/src/openai.rs`. NEVER `git add -A`; every commit stages only the files its task lists. If any listed file is dirty at commit time, stop and reconcile.
- Work on branch `feat/memory-profile-ingest` (create with `git switch -c` at execution time; the tree is at the merged `slim/caching-lean-99` tip). Do not push, tag, or open a PR without explicit user approval (repo rule; one PR at a time).
- Mid-loop verification is `CARGO_BUILD_JOBS=4 cargo test -p gray <filter>` — never `--workspace` mid-loop. Full `cargo fmt --check`, `cargo clippy --workspace -- -D warnings`, `cargo test --workspace` once in Task 5.
- Store format is frozen: one `- key: value <!-- gray:saved=YYYY-MM-DD;source=... -->` line per entry, 0600 files, 0700 dirs, existing lock discipline. No migration, no schema change, no new dependencies.
- First-sentence rule (verbatim from spec): cut at the first `". "` whose preceding token is >= 2 chars; no-boundary values are served whole; never truncate mid-sentence.
- B3: the ingest contract may `set` and `edit` only; `remove`/`clear` are forbidden to it. Caps: 10 writes/run, <= 2 user-scope writes/run, 100 transcripts / 4 MB read per run.
- Follow superpowers:test-driven-development inside every task: failing test first, minimal code, then refactor.

---

### Task 1: first-sentence extraction + `profile()`

**Files:**
- Modify: crates/gray/src/memory.rs (add `profile()`, private `first_sentence()`, switch `snapshot()` to mode-aware rendering)
- Test: crates/gray/src/memory_tests.rs

**Interfaces:**
- Produces: `fn first_sentence(text: &str) -> &str` (private to memory.rs); `pub fn MemoryStore::profile(&self, scope: Scope) -> anyhow::Result<String>`; `pub fn MemoryStore::snapshot_with(&self, session: Option<&str>, mode: MemoryInjection) -> anyhow::Result<String>`; `pub enum MemoryInjection { Summary, Full }` with `Default = Summary` (defined here in Task 1, wired to config in Task 2). Note the implemented shape: `snapshot(session)` keeps its old signature and delegates to `snapshot_with(session, MemoryInjection::default())` — the spec's single mode-taking signature was split so the feature lands without editing `lib.rs` line 190, which a sibling session had dirty. `snapshot` therefore serves summaries for every existing caller, and the `full` toggle only needs the one-line pass-through in `build_agent` once that file is free.

- [ ] **Step 1: Write the failing tests** in `crates/gray/src/memory_tests.rs` (module already wired at memory.rs:771). Follow the existing store-fixture helpers in that file:

```rust
#[test]
fn first_sentence_cuts_at_period_space() {
    assert_eq!(super::first_sentence("One thing. Then another."), "One thing.");
}

#[test]
fn first_sentence_ignores_abbreviations_and_decimals() {
    assert_eq!(super::first_sentence("Use v1.3, e.g. this. Next."), "Use v1.3, e.g. this.");
    assert_eq!(super::first_sentence("Costs 3.5 USD total. Next."), "Costs 3.5 USD total.");
    assert_eq!(super::first_sentence("See i.e. this file. Next."), "See i.e. this file.");
}

#[test]
fn first_sentence_serves_whole_when_unbounded() {
    assert_eq!(super::first_sentence("No terminal period"), "No terminal period");
}

#[test]
fn profile_matches_list_when_every_entry_is_one_sentence() {
    let store = fixture();
    store.set(Scope::Project, "a", "Short.").unwrap();
    store.set(Scope::Project, "b", "Also short.").unwrap();
    assert_eq!(store.profile(Scope::Project).unwrap(), store.list(Scope::Project).unwrap());
}

#[test]
fn snapshot_carries_summaries_by_default_and_full_text_on_request() {
    let store = fixture();
    store.set(Scope::Project, "long", "First bit. Second bit that is long.").unwrap();
    let summary = store
        .snapshot_with(None, MemoryInjection::Summary)
        .unwrap();
    assert!(summary.contains("First bit."));
    assert!(!summary.contains("Second bit"));
    let full = store.snapshot_with(None, MemoryInjection::Full).unwrap();
    assert!(full.contains("Second bit that is long."));
}
```

  Adapt fixture construction to the helpers already present in `memory_tests.rs` (a `tempfile::TempDir` home + cwd pair); do not invent a second fixture style. `snapshot(None)` is the anonymous headless form used by existing tests at memory_tests.rs:313.

- [ ] **Step 2: Run and watch them fail**: `CARGO_BUILD_JOBS=4 cargo test -p gray first_sentence profile_matches snapshot_carries` — expect compile errors for `first_sentence`, `profile`, `MemoryInjection`.

- [ ] **Step 3: Implement minimally** in `crates/gray/src/memory.rs`:

```rust
/// First sentence: cut at the first ". " whose preceding token is at
/// least 2 chars, so "e.g. ", "i.e. " and "3.5 " never end a sentence.
/// No truncation: an unbounded value is served whole.
fn first_sentence(text: &str) -> &str {
    let bytes = text.as_bytes();
    let mut from = 0;
    while let Some(rel) = text[from..].find(". ") {
        let dot = from + rel;
        let token_start = text[..dot].rfind(|c: char| c.is_whitespace()).map_or(0, |i| i + 1);
        if dot - token_start >= 2 {
            return &text[..dot + 1];
        }
        from = dot + 2;
    }
    text
}
```

  `profile()` mirrors `list()` but maps each value through `first_sentence` before `render_served`-style joining (reuse the same `- {key}: {value}\n` rendering as `render_served`, memory.rs:669). `snapshot()` takes `mode: MemoryInjection`, calls `profile()` for `Summary` and today's `list()` for `Full` in both the capture closure and nothing else changes (frozen-on-disk path, project check, and `parse()` validation of read-back summaries all stay). `MemoryInjection` derives `Debug, Clone, Copy, PartialEq, Eq, Default` with `#[default] Summary`.

- [ ] **Step 4: Existing `snapshot` callers stay untouched** (the split signature above means memory_tests.rs:301-329, 438-443 compile unchanged). Their entries are single sentences, so their assertions pass under both modes; `snapshot_is_frozen_on_rebuild_and_resume_but_new_session_gets_updates` still exercises freeze semantics unchanged.

- [ ] **Step 5: Run the memory suite**: `CARGO_BUILD_JOBS=4 cargo test -p gray memory` — all green.

- [ ] **Step 6: Commit**: `git add crates/gray/src/memory.rs crates/gray/src/memory_tests.rs && git commit -m "memory: inject one-sentence profile summaries"`.

---

### Task 2: `memory_injection` config toggle + plumbing

**Files:**
- Modify: crates/gray/src/setup/catalog.rs (`SavedConfig`: add `memory_injection: Option<String>` at line ~87, same serde style)
- Modify: crates/gray/src/config.rs (`Config` field + `resolve_with` wiring; add `#[cfg(test)] #[path = "config_tests.rs"] mod tests;` at file end)
- Test: crates/gray/src/config_tests.rs (create)
- Modify: crates/gray/src/lib.rs (`build_agent` passes `config.memory_injection` into `snapshot`, line ~190)

**Interfaces:**
- Consumes: `MemoryInjection` + `snapshot(session, mode)` from Task 1.
- Produces: `Config.memory_injection: MemoryInjection` (public field, default `Summary`); `SavedConfig.memory_injection: Option<String>` accepting `"summary" | "full"` (unknown values fall back to `Summary`, never an error).

- [ ] **Step 1: Failing tests** in new `crates/gray/src/config_tests.rs`:

```rust
#[test]
fn memory_injection_defaults_to_summary() {
    let cli = crate::lib::Cli::parse_from(["gray"]);
    let config = crate::config::Config::resolve_with(&cli, |_| None).unwrap();
    assert_eq!(config.memory_injection, crate::memory::MemoryInjection::Summary);
}

#[test]
fn saved_full_injection_is_honored_and_junk_falls_back() {
    // write a SavedConfig JSON with "memory_injection":"full" into a temp
    // GRAY_HOME via setup::save_saved_config_at, resolve, assert Full;
    // then "banana" -> Summary.
}
```

  Use `Config::resolve_with(&cli, |_| None)` exactly as `repl/plugin_cmds_tests.rs:80` does; for the saved-file half use the `save_saved_config_at` + `load_saved_config_at` pair from `crate::setup` against a `tempfile::TempDir` (these take explicit paths — do not touch the real `~/.gray/config.json`).

- [ ] **Step 2: Run, expect failure**: `CARGO_BUILD_JOBS=4 cargo test -p gray memory_injection`.

- [ ] **Step 3: Implement**:
  - `SavedConfig`: `#[serde(skip_serializing_if = "Option::is_none")] pub memory_injection: Option<String>,`
  - `Config`: `pub memory_injection: crate::memory::MemoryInjection` (documented: what's injected every turn; `Full` restores pre-2026-09-23 bytes), resolved in `resolve_with` as `saved.memory_injection.as_deref().map_or(MemoryInjection::Summary, MemoryInjection::from_saved)` with `impl MemoryInjection { pub fn from_saved(raw: &str) -> Self { if raw.eq_ignore_ascii_case("full") { Full } else { Summary } } }` in memory.rs.
  - `lib.rs` build_agent: `.snapshot_with(session_id, config.memory_injection)` — BLOCKED while a sibling session has the file dirty; land with their work or ask first.

- [ ] **Step 4: Run** `CARGO_BUILD_JOBS=4 cargo test -p gray memory_injection` then `cargo test -p gray memory` — green.

- [ ] **Step 5: Commit**: `git add crates/gray/src/setup/catalog.rs crates/gray/src/config.rs crates/gray/src/config_tests.rs crates/gray/src/lib.rs crates/gray/src/memory.rs && git commit -m "config: memory_injection summary|full escape hatch"`.

---

### Task 3: one prompt line so the model fetches full entries

**Files:**
- Modify: crates/gray/src/system_prompt.rs (`MEMORY_POLICY`, line ~64-68)
- Test: crates/gray/src/system_prompt_tests.rs

**Interfaces:**
- Consumes: nothing. Produces: policy text naming `gray memory show KEY` as the full-text fetch (the verb already exists; no new CLI).

- [ ] **Step 1: Failing test** in `system_prompt_tests.rs`: the assembled prompt contains the guidance and still mentions `gray memory show KEY`:

```rust
#[test]
fn policy_says_injected_entries_are_summaries() {
    let prompt = build_system_prompt(opts("You are gray."));
    assert!(prompt.contains("one-sentence summaries"));
    assert!(prompt.contains("gray memory show KEY"));
}
```

  `build_system_prompt` and the `opts` helper already exist in
  system_prompt_tests.rs (lines 3-9); the test file does `use super::*`.

- [ ] **Step 2: Run, expect fail**: `CARGO_BUILD_JOBS=4 cargo test -p gray policy_says_injected`.

- [ ] **Step 3: Implement** — extend the existing sentence in `MEMORY_POLICY` that already names `gray memory show KEY` (do not append a new paragraph; the policy is injected every turn and bloat is the thing we're removing):

  > The injected block holds one-sentence summaries; `gray memory show KEY` prints an entry in full — fetch it before relying on a remembered decision.

- [ ] **Step 4: Run** `CARGO_BUILD_JOBS=4 cargo test -p gray system_prompt` — green. Then confirm byte-stability of the prompt for a fixed store: the existing `rebuild_is_byte_stable` test in system_prompt_tests.rs:8 must still pass unmodified.

- [ ] **Step 5: Commit**: `git add crates/gray/src/system_prompt.rs crates/gray/src/system_prompt_tests.rs && git commit -m "prompt: tell the model to show KEY before relying on memory"`.

---

### Task 4: ingest contract + dry run + job install (no Rust)

**Files:**
- Create: docs/memory-ingest-contract.md (the verbatim contract prompt from the spec + the exact `gray cron add` line)
- Modify: none in crates/

**Interfaces:**
- Consumes: `gray cron add` CLI (crates/gray/src/lib.rs:440 `CronCmd::Add`: positional schedule + prompt, `--name`, `--in`, `--deliver local`), `gray memory set/edit` CLI, session JSONL headers (`{cwd, timestamp}` first line, verified on this box).
- Produces: the installed cron job `memory-ingest` on this machine, paused-then-verified; docs file as copy-paste source of truth.

- [ ] **Step 1: Write** `docs/memory-ingest-contract.md`: copy the contract prompt verbatim from the spec's "The contract prompt" section, but make the cwd filter generic ("header `cwd` equals this job's working directory") so the same text works for any project, and paste the install command:

```
# from the repo root, with the contract text pasted as the prompt argument
gray cron add "10 4 * * *" "<paste the ## Prompt section verbatim>" \
  --name memory-ingest --in /home/vstaln/gray --deliver local
```

  The point is that the text lives in the repo, not only in one operator's
  shell history; Steps 2 and 4 run the same text.

- [ ] **Step 2: Dry run, headless, scratch home** — from `/home/vstaln/gray`:

```
cp -a ~/.gray/memory /tmp/ingest-dryrun-memory
GRAY_HOME=/tmp/ingest-dryrun-home ./target/debug/gray -p "<contract prompt verbatim>"
```

  with `/tmp/ingest-dryrun-home/memory` pre-seeded from the real store. Because `HOME` is unchanged, the run reads the real `~/.gray/sessions` but writes only into the scratch store (`setup::gray_home()` honors `GRAY_HOME`).

- [ ] **Step 3: Verify the dry run**: `gray memory list --scope project` equivalent under the scratch home parses; `diff` the scratch store before/after and assert (a) only `set`/`edit` lines appeared, (b) <= 10 writes, (c) <= 2 of them user scope, (d) every new line contains `Why:` and `falsified:`; run the identical prompt a second time and assert zero writes (idempotence). Record the actual counts in the PR description.

- [ ] **Step 4: Install for real, paused-first**:

```
gray cron add "10 4 * * *" "<contract>" --name memory-ingest --in /home/vstaln/gray --deliver local
gray cron pause memory-ingest && gray cron run memory-ingest   # one supervised fire
gray memory list                                                  # eyeball what it wrote
gray cron resume memory-ingest
```

  If the supervised fire misbehaves, leave it paused and report — the job is operator state, not repo state.

- [ ] **Step 5: Commit the doc only**: `git add docs/memory-ingest-contract.md && git commit -m "docs: daily memory ingest contract"`.

---

### Task 5: gates, re-read, report

- [ ] **Step 1: Re-read every file changed in Tasks 1-4** (`git diff main...HEAD --stat` then read each diff hunk; check trailing newlines, exact bytes, no stray debug prints).
- [ ] **Step 2: Full gates** per repo CI: `cargo fmt --check`, `CARGO_BUILD_JOBS=4 cargo clippy --workspace -- -D warnings`, `CARGO_BUILD_JOBS=4 cargo test --workspace --quiet`. Expect the known environment flake cluster (5 gray-lib tests: `skills_tool::tests::project_context_block_*`, `memory::tests::invalid_snapshot_and_wrong_project_fail_closed` — they fail because `/home/vstaln/AGENTS.md` exists on this box; confirm by running them on a pristine HEAD worktree before blaming this diff).
- [ ] **Step 3: Manual end-to-end on this box**: new session shows the short block (`gray -p "list your memory keys only"` and check the injected block is one-liners), `gray memory show <key>` returns full text, `gray memory --scope user list` still full.
- [ ] **Step 4: Report + ask** the user about opening the PR (repo rule: never push/open unasked; one PR only). PR body: spec + plan links, prune summary (25 entries / 23.5 KB, backup path), dry-run counts from Task 4, gates status.
