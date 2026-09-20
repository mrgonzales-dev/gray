# Simplification pass — handoff for integration

What happened here, what changed, and how to land it. Written for the next agent (human or AI).

## TL;DR

Branch `simplify/jev-findings` (worktree at `../gray-simplify`) removes **188 net lines** from two TUI
files by extracting same-file helpers over repeated render scaffolding. Behavior unchanged. Full
workspace test suite passes; `cargo fmt --check` clean. Nothing else was touched on purpose.

## How the targets were chosen

The whole codebase (308 Rust files, 390 chunks) was judged by TypeSafe's System One model Jev
(`jev-latest`) using the [ponytail](https://github.com/dietrichgebert/ponytail) ladder as the rubric:
YAGNI → reuse-in-codebase → std → one-liner, plus a **guard question** for content a lazy refactor
must not cut (trust-boundary validation, data-loss error handling, security).

Raw outputs: `typesafe_results.jsonl` (1 judgment set per ~450-line chunk) and
`typesafe_drill_results.jsonl` (second pass on the top 12 chunks) — both untracked in the main
checkout, regenerable with the committed-ish scripts `typesafe_scan.mjs` / `typesafe_drill.mjs` /
`typesafe_report.mjs` (also untracked, `TYPESAFE_API_KEY` required).

Key repo-wide facts (see `SIMPLIFY_REPORT.md`):

- Mean shrink-fraction 1.1–1.3 of 4 → the codebase is **already mostly lazy**. Only 2 chunks scored
  >= 2, and both were false positives on inspection.
- Real signal: `nearby_duplicate` strong in 48 source chunks; `over-abstraction` ~zero.
- Guard-heavy files left alone: `gray-pkg/src/fetch.rs`, `gray-tools/src/read/tail.rs`,
  `gray-pkg/src/skills_ops.rs` (validation/security content).

## What changed

### 1. `crates/gray/src/setup/connect_draw.rs` (−223 net lines)

The three `render_*` functions each hand-rolled the same dialog scaffold: centered+clamped rect with
Clear + bg block + padded inner rect, a title row with right-aligned `esc`, a bold-key/dim-desc
footer, an error-note-or-default line, and the cleared input row. Extracted five boring same-file
helpers, no new module, no trait:

- `centered_dialog(frame, area, w, h, min_w, min_h, colors) -> Rect` (inner rect)
- `render_header_esc(frame, inner, title, colors)`
- `render_footer(frame, inner, &[(key, desc)], colors)`
- `render_note_or_status(frame, inner, status_msg, note, colors)`
- `render_input_row(frame, inner, content, colors)`

Note: `centered_dialog` preserves the original *behavioral* quirk (min clamps applied after max) —
it is a mechanical consolidation, not a fix.

### 2. `crates/gray/src/setup/install_manager.rs` (−107 net lines)

The three `Tab::` footer arms repeated ~20 lines of bold-key/dim-desc span pairs each. Replaced with
a `kv(k, v, box_bg, text_dim) -> [Span; 2]` helper plus a per-tab `&[(&str, &str)]` middle table and
a shared tail. Copy byte-identical.

## Verification already run

```
cargo fmt --check          # clean
cargo test --workspace     # all suites: 0 failed
```

Targeted: `cargo test -p gray --lib connect_draw` (4 tests) and `... install_manager` (13 tests) pass.

## How to integrate

```bash
cd /home/vstaln/gray
git diff main..simplify/jev-findings          # review
git merge simplify/jev-findings               # or cherry-pick, or open a PR from the branch
cargo test --workspace && cargo fmt --check   # re-verify on your machine
```

Worktree cleanup after landing: `git worktree remove ../gray-simplify`.

If conflicts appear: both edits are pure in-file extractions; re-apply by taking the *helpers* from
this branch and deleting the repeated blocks on main — do not hand-merge the span soup.

## Deliberately NOT done (ponytail verdicts, do not "finish" these without reading the reasoning)

1. **`repl/handlers.rs` 412-695** — Jev scored the TUI/headless print fork as duplication (0.99).
   It is house style (5 other files use the same shape) with per-callsite `ensure_gap` variance and
   distinct headless copy (`model error:` vs `effort error:`). Guard score 0.81. Unifying changes
   visible copy or adds an abstraction carrying two strings. Skip.
2. **`gray-tools/src/edit_diff.rs`** — hand-rolled LCS line diff. `similar` is NOT a workspace dep,
   and the file header documents the tradeoff with an upgrade path. Adding a dep for working tested
   code is rung-5-before-rung-3 violation in reverse. Only swap if `similar` gets added anyway.
3. **`gray-core/src/paths.rs`, `gray/src/setup/mod.rs`** — top shrink scores, but low confidence
   (0.03–0.08) and inspection shows both exist for specific documented reasons (std `home_dir`
   pitfalls; module facade). False positives; left alone.
4. **Guard-heavy files** (`fetch.rs`, `tail.rs`, `skills_ops.rs`, `read/guard.rs`) — flagged as
   having trust-boundary/security content. Simplify around them, not through them.

## Leftover opportunities (from the same scan, not yet acted on)

Ranked by confidence × size, all `nearby_duplicate`-flavored, none guard-heavy:

- `crates/gray/src/setup/connect.rs` 451-696 — dispatch chains (high conf from first pass)
- `crates/gray/src/setup/context_modal.rs` 372-526 — dispatch (conf 1.00)
- `crates/gray/src/setup/context/providers.rs` 1-444 — dispatch (conf 0.97)
- `crates/gray-tools/src/edit_diff.rs` 1-450 — verbose blocks (guard present, mild)

Triage with the report before touching: anything with `guard` >= 0.75 needs a read first.
