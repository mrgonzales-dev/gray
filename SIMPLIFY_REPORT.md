# Gray codebase simplification report

Judged by TypeSafe Jev (`jev-1.13.0`): 390 chunks across 308 Rust files (229 source, 161 test). 1,169,833 input tokens.

Each chunk got 6 independent judgments on the ponytail ladder: YAGNI (should it exist), nearby duplication (reuse), std replacement, a lazy-violation guard (hard-line content), a 0-4 shrink-fraction score, and the single laziest move.

## Systemic signals (source code)

| Signal | strong (>=0.75) | moderate (0.6-0.75) | mean noul |
|---|---|---|---|
| yagni | 0 chunks | 43 chunks | 0.49 |
| nearby_duplicate | 48 chunks | 61 chunks | 0.54 |
| stdlib_replacement | 20 chunks | 36 chunks | 0.47 |
| lazy_violation (high = guarded, don't cut blindly) | 78 chunks | 41 chunks | 0.57 |

### Laziest-move distribution for source chunks scored >= 2 (2 chunks)

- **swap_to_std**: 1 chunks
- **collapse_to_one_liner**: 1 chunks

## Drill-down on top chunks (second Jev pass, ponytail lens)

| Location | Dominant bloat (conf) | One-helper payoff | Deletable present | Guard content | Focused shrink |
|---|---|---|---|---|---|
| `crates/gray-tools/src/read/testkit.rs` 1-190 | repeated_block (0.44) | 0.26 | 0.53 | 0.19 | 1.26/4 |
| `crates/gray/src/setup/mod.rs` 1-148 | none_notable (0.39) | 0.27 | 0.65 | 0.74 | 1.13/4 |
| `crates/gray/src/repl/handlers.rs` 412-695 | repeated_block (0.99) | 0.56 | 0.38 | 0.81 | 0.94/4 |
| `crates/gray-core/src/paths.rs` 1-27 | none_notable (0.79) | 0.12 | 0.15 | 0.46 | 0.91/4 |
| `crates/gray/src/setup/install_manager.rs` 451-700 | repeated_block (0.86) | 0.54 | 0.50 | 0.44 | 0.86/4 |
| `crates/gray/src/setup/connect_draw.rs` 425-687 | repeated_block (0.98) | 0.52 | 0.38 | 0.18 | 0.81/4 |
| `crates/gray/src/setup/tabs.rs` 1-100 | none_notable (0.48) | 0.21 | 0.30 | 0.07 | 0.64/4 |
| `crates/gray-tools/src/read/tail.rs` 1-70 | none_notable (0.82) | 0.12 | 0.21 | 0.89 | 0.63/4 |
| `crates/gray-tools/src/read/resolve.rs` 1-248 | hand_rolled (0.58) | 0.25 | 0.34 | 0.63 | 0.52/4 |
| `crates/gray/src/setup/connect_draw.rs` 1-424 | repeated_block (0.89) | 0.54 | 0.52 | 0.35 | 0.47/4 |
| `crates/gray-pkg/src/skills_ops.rs` 443-536 | none_notable (0.62) | 0.28 | 0.42 | 0.87 | 0.43/4 |
| `crates/gray-pkg/src/fetch.rs` 1-345 | hand_rolled (0.96) | 0.26 | 0.48 | 0.97 | 0.27/4 |

*One-helper payoff*: probability one new helper with >=3 call sites removes >=10% of the chunk. 
*Deletable present*: probability unused/speculative code exists here. *Guard content*: probability trust-boundary 
validation, data-loss error handling, or security code is present (simplify around it). *Focused shrink*: 0-4 
fraction of the chunk the identified moves remove, behavior unchanged.

## By crate (source code)

| Crate | chunks | mean shrink | mean chars/chunk | strong (yagni/dup/std/guard) |
|---|---|---|---|---|
| gray-tools | 42 | 1.27 | 7569 | 0/6/5/18 |
| gray-pkg | 13 | 1.25 | 9402 | 0/4/3/9 |
| gray | 121 | 1.25 | 9791 | 0/28/9/31 |
| gray-plugin | 8 | 1.18 | 9315 | 0/2/0/4 |
| gray-markdown | 19 | 1.12 | 11251 | 0/2/1/1 |
| gray-core | 18 | 1.10 | 10046 | 0/2/1/8 |
| gray-provider | 8 | 1.09 | 14936 | 0/4/1/7 |

## Top 30 source-code chunks by shrink fraction (ponytail)

| Shrink | Conf | Location | Lines | Signals | Laziest move |
|---|---|---|---|---|---|
| 2.16 | 0.08 | `crates/gray/src/setup/mod.rs` | 1-148 | — | collapse_to_one_liner |
| 2.14 | 0.03 | `crates/gray-core/src/paths.rs` | 1-27 | — | swap_to_std |
| 1.88 | 0.48 | `crates/gray/src/setup/connect_draw.rs` | 425-687 | nearby duplicate | extract_one_helper |
| 1.77 | 0.17 | `crates/gray-tools/src/read/resolve.rs` | 1-248 | stdlib replacement | swap_to_std |
| 1.72 | 0.55 | `crates/gray/src/repl/handlers.rs` | 412-695 | nearby duplicate | extract_one_helper |
| 1.69 | 0.30 | `crates/gray-tools/src/read/testkit.rs` | 1-190 | stdlib replacement | swap_to_std |
| 1.68 | 0.46 | `crates/gray/src/setup/connect_draw.rs` | 1-424 | nearby duplicate | extract_one_helper |
| 1.62 | 0.43 | `crates/gray/src/setup/install_manager.rs` | 451-700 | nearby duplicate | extract_one_helper |
| 1.62 | 0.40 | `crates/gray-pkg/src/fetch.rs` | 1-345 | nearby duplicate, stdlib replacement, lazy violation | swap_to_std |
| 1.62 | 0.19 | `crates/gray/src/setup/tabs.rs` | 1-100 | — | collapse_to_one_liner |
| 1.60 | 0.26 | `crates/gray-pkg/src/skills_ops.rs` | 443-536 | — | swap_to_std |
| 1.60 | 0.15 | `crates/gray-tools/src/read/tail.rs` | 1-70 | lazy violation | already_lazy |
| 1.59 | 0.32 | `crates/gray-tools/src/read/guard.rs` | 1-138 | lazy violation | collapse_to_one_liner |
| 1.57 | 0.44 | `crates/gray/src/skills/load.rs` | 1-307 | stdlib replacement | swap_to_std |
| 1.55 | 0.42 | `crates/gray-tools/src/edit_diff.rs` | 451-764 | nearby duplicate, stdlib replacement | swap_to_std |
| 1.55 | 0.20 | `crates/gray/src/text_width.rs` | 1-55 | — | collapse_to_one_liner |
| 1.53 | 0.38 | `crates/gray/src/skills_tool.rs` | 1-140 | stdlib replacement | delete_it |
| 1.52 | 0.32 | `crates/gray/src/setup/icons.rs` | 1-51 | — | extract_one_helper |
| 1.52 | 0.32 | `crates/gray/src/shell_drain.rs` | 1-65 | — | collapse_to_one_liner |
| 1.52 | 0.26 | `crates/gray-tools/src/read/args.rs` | 1-78 | lazy violation | extract_one_helper |
| 1.51 | 0.49 | `crates/gray/src/composer/input/attach.rs` | 1-161 | nearby duplicate, lazy violation | reuse_existing |
| 1.51 | 0.47 | `crates/gray-tools/src/edit_diff.rs` | 1-450 | stdlib replacement, lazy violation | collapse_to_one_liner |
| 1.51 | 0.47 | `crates/gray/src/plugin_check.rs` | 1-210 | nearby duplicate | extract_one_helper |
| 1.50 | 0.42 | `crates/gray/src/repl/session.rs` | 765-835 | nearby duplicate | extract_one_helper |
| 1.50 | 0.33 | `crates/gray/src/tool_fmt/plain.rs` | 1-71 | — | reuse_existing |
| 1.49 | 0.44 | `crates/gray-pkg/src/ops.rs` | 414-852 | nearby duplicate, lazy violation | collapse_to_one_liner |
| 1.49 | 0.41 | `crates/gray/src/profile.rs` | 1-118 | nearby duplicate | reuse_existing |
| 1.49 | 0.27 | `crates/gray-tools/src/read/dedup.rs` | 1-77 | — | already_lazy |
| 1.47 | 0.41 | `crates/gray-tools/src/write.rs` | 1-267 | lazy violation | collapse_to_one_liner |
| 1.46 | 0.48 | `crates/gray/src/setup/model_modal.rs` | 1-412 | — | reuse_existing |

## Top 15 test-code chunks by shrink fraction (ponytail)

| Shrink | Conf | Location | Lines | Signals | Laziest move |
|---|---|---|---|---|---|
| 2.46 | 0.35 | `crates/gray/src/composer/mod_compaction_tests.rs` | 1-33 | — | already_lazy |
| 2.19 | 0.19 | `crates/gray/src/turn_caps_tests.rs` | 1-41 | — | extract_one_helper |
| 2.15 | 0.22 | `crates/gray/src/repl/cron_tests.rs` | 1-63 | — | delete_it |
| 2.11 | 0.35 | `crates/gray/src/setup/install_manager_tests.rs` | 1-190 | — | reuse_existing |
| 1.97 | 0.40 | `crates/gray/src/repl/prompt_turn_tests.rs` | 1-274 | nearby duplicate | extract_one_helper |
| 1.95 | 0.32 | `crates/gray-pkg/src/fetch_tests.rs` | 1-239 | nearby duplicate, stdlib replacement, lazy violation | reuse_existing |
| 1.93 | 0.38 | `crates/gray-tools/src/read/dedup_tests.rs` | 1-112 | nearby duplicate | extract_one_helper |
| 1.93 | 0.34 | `crates/gray-pkg/src/errors_tests.rs` | 1-60 | — | extract_one_helper |
| 1.92 | 0.44 | `crates/gray/src/setup/remove_tests.rs` | 1-282 | nearby duplicate | extract_one_helper |
| 1.91 | 0.38 | `crates/gray-markdown/src/streaming_torn_tests.rs` | 1-68 | nearby duplicate | reuse_existing |
| 1.88 | 0.45 | `crates/gray/tests/backdrop_dim.rs` | 1-79 | — | extract_one_helper |
| 1.85 | 0.36 | `crates/gray-core/src/compact_mod_tests.rs` | 1-445 | nearby duplicate | reuse_existing |
| 1.81 | 0.37 | `crates/gray-pkg/src/ops_tests.rs` | 1-445 | nearby duplicate, stdlib replacement | swap_to_std |
| 1.80 | 0.19 | `crates/gray-core/src/agent_tests.rs` | 1-436 | — | delete_it |
| 1.79 | 0.45 | `crates/gray-plugin/tests/sidecar.rs` | 445-567 | — | extract_one_helper |

## File-level priorities (source)

Files ranked by weighted shrink: mean chunk score × chunk size (a proxy for total code removable).

| File | mean score | lines scanned | weighted |
|---|---|---|---|
| `crates/gray-provider/src/openai.rs` | 1.11 | 2680 | 2986 |
| `crates/gray-markdown/src/parse.rs` | 1.01 | 1850 | 1861 |
| `crates/gray-pkg/src/ops.rs` | 1.26 | 1390 | 1744 |
| `crates/gray/src/session_store.rs` | 1.26 | 1163 | 1462 |
| `crates/gray/src/composer/mod.rs` | 1.17 | 1182 | 1383 |
| `crates/gray/src/setup/context/providers.rs` | 1.24 | 1071 | 1332 |
| `crates/gray/src/setup/connect_draw.rs` | 1.78 | 687 | 1223 |
| `crates/gray-tools/src/edit_diff.rs` | 1.53 | 764 | 1169 |
| `crates/gray-pkg/src/sources.rs` | 1.13 | 1017 | 1146 |
| `crates/gray/src/repl/mod.rs` | 1.25 | 891 | 1118 |
| `crates/gray/src/plugin_cli.rs` | 1.28 | 843 | 1079 |
| `crates/gray/src/setup/install_manager.rs` | 1.53 | 700 | 1071 |
| `crates/gray/src/repl/session.rs` | 1.20 | 835 | 1005 |
| `crates/gray/src/repl/handlers.rs` | 1.42 | 695 | 987 |
| `crates/gray-core/src/agent_loop.rs` | 0.96 | 996 | 959 |
| `crates/gray-tools/src/grep.rs` | 1.36 | 660 | 901 |
| `crates/gray/src/setup/connect.rs` | 1.28 | 696 | 891 |
| `crates/gray/src/resume.rs` | 1.28 | 689 | 882 |
| `crates/gray/src/tool_fmt/mod.rs` | 1.08 | 794 | 861 |
| `crates/gray/src/repl/status.rs` | 1.24 | 674 | 836 |

## Method & caveats

- Model: `jev-latest` → jev-1.13.0, one batched request per ~450-line chunk (all 6 questions see the same state).
- Noul values are probabilities (0=no, 1=yes); >= 0.75 counted as a strong signal, not proof.
- lazy_violation is a guard: high values mark trust-boundary validation, data-loss error handling, or security code. Simplify around it, not through it.
- Score confidence summarizes how concentrated the rating distribution is; use it to triage, not as ground truth.
- Chunks cut at ~450 lines on brace/blank boundaries, so findings are local, not whole-file design verdicts.
- Raw judgments kept in `typesafe_results.jsonl` for re-aggregation with different thresholds.
