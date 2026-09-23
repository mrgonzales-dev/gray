# Hermes' plugin system vs gray — what to take, and what landed

Study of `https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins` and the
pages it links (built-in plugins, plugin catalog, hooks, MCP, the developer plugin
guide, extending the CLI) against gray's sidecar model. Source reference:
`reference/NousResearch/hermes-agent` (shallow clone of `main`).

## The eight ideas, ranked by what gray gets from them

| # | Hermes idea | Verdict | Why |
|---|---|---|---|
| 1 | Install-time security scan (safe / caution / dangerous) | **Landed** | gray installs compile pinned git source or run an arbitrary `GRAY_PLUGIN_PATH` executable. Nothing looked at it first. |
| 2 | Capability declarations + consent | **Landed** | Every enabled sidecar could already call `host/run`, `host/say`, `host/ask` and shadow a builtin tool. Now each is granted, not assumed. |
| 3 | Config-driven shell hooks (`hooks:` block, JSON on stdin/stdout) | Next | Highest capability-per-line in the whole system: veto, rewrite, context injection, observers — no Rust needed. |
| 4 | Catalog file + plugin packs (`hermes-pack.yaml`) | Next | `CATALOG` is one hardcoded entry in `plugin_cli.rs`; a YAML catalog plus pinned packs scales past two plugins. |
| 5 | More hooks (`session_start/end`, per-turn context, `transform_tool_result`) | Next | gray has 8 hook methods; add only where a fire site exists (Hermes' own rule: never mint inert hook names). |
| 6 | `ctx.inject_message` + `allow_gateway_injection` | Later | Unblocks webhook/bridge plugins; needs the same grant discipline as `host/*`. |
| 7 | MCP servers as config-declared tool sources | Later, big | gray has **no MCP at all** — the largest functional gap against Hermes/Claude Code. Fits the sidecar model, but it is its own project. |
| 8 | Approval transports | **Skipped** | `host/ask` already *is* the transport; a plugin-registerable one duplicates it. |

Deliberately not ported: Python in-process plugins (`register(ctx)`), the desktop/UI plugin
SDK, NixOS declarative installs, pip entry points, `hermes://` deep links. gray's contract is
prebuilt executables over NDJSON, and it ships no Python on purpose.

## What landed

### `gray-plugin::scan` — install-time scan

`crates/gray-plugin/src/scan.rs`. Runs over a plugin's source before it is built, published or
spawned. Three verdicts, Hermes' pass/warn/fail:

- **safe** — install normally, one line of output
- **caution** — findings printed, operator confirms, `--force` accepts; a session that cannot
  ask refuses instead of installing unreviewed code
- **dangerous** — blocked, and `--force` does not override

The exemption ladder is the part copied deliberately, because it is what stops a scanner from
crying wolf and being switched off:

| Text that cannot run here | Severity |
|---|---|
| Prose quoting a command (README uninstall, a refusal list naming `~/.ssh`) | one step down |
| Prose removing the plugin's own `.gray/plugins/<name>` | note |
| A quoted-only hostile string in a fixture (`verdict_for("rm -rf /")`) | note |
| The same string in a script, or handed to an executor | capped at caution |
| A fake provider key in a redaction corpus (`sk-…` in `tests/`) | note |
| Base64 that decodes to a media header, or `base64 -d \| jq` | note |
| Anything under `skills/` or `after-install.md` | full severity — the agent reads it as instructions |
| Prompt injection, `curl … \| sh`, an `authorized_keys` append, a real credential | full severity, wherever it lives |

gray-specific rule: reading `~/.gray/auth.json` or `gateway.yaml` is a credential-store read
(Hermes has no equivalent), and reading one next to a network verb is `credential_exfil`.

### `gray-plugin::capabilities` — declarations and consent

`crates/gray-plugin/src/capabilities.rs`. Five capabilities, one per surface that actually
enforces something:

| id | opens | enforced at |
|---|---|---|
| `host.turn` | `host/run` — an agent turn with the user's model and budget | sidecar reader |
| `host.ask` | `host/ask` — blocking question mid tool call | sidecar reader |
| `host.say` | `host/say` — a line in the conversation | sidecar reader |
| `tool.override` | shadow a builtin tool (`bash`, `read`, …) | `builder::from_plugins` |
| `widget.override` | own the above-editor widget slot | install path |

An ungranted `host/*` call is refused with `{"error": "capability_not_granted: host.ask",
"hint": "gray plugin capabilities <name>"}` — the sidecar gets something actionable, never the
host's power. Tool claims on a builtin surface without `tool.override` are dropped with a
warning naming the grant command.

Consent is recorded per lock entry (`granted_capabilities` + `capabilities_hash`):

- **declaring is not consent** — `plugin/manifest` declares; the operator grants
- **install asks once**; a session that cannot prompt grants nothing but still records the
  hash, so the plugin runs ungranted rather than grandfathered
- **update re-consents the additions** (`needs_reconsent`); a manifest that stops declaring a
  capability cannot keep using it
- **pre-consent entries are grandfathered** to whatever they declare — they ran with those
  powers before consent existed, and silently breaking them on upgrade is worse
- **profile sidecars** (argv the operator wrote in `gray.yml`) are trusted by placement, same
  as Hermes' dir-trust: they keep everything they declare

`capabilities_hash` is a digest of the *sorted* declared list, so declaration order is not
semantic. Unknown ids are dropped with a warning rather than minted: an id nothing enforces is
a promise, not a gate.

### CLI

```
gray install plugin <name> [--force]     # scans before it builds/publishes
gray plugin capabilities [name]          # declared vs granted, per plugin
gray plugin check <dir>                  # unchanged: sidecar conformance
```

## Verification

- `cargo test -p gray-plugin` (34 lib + 15 sidecar integration + lock/builder suites), full
  `cargo test -p gray` (650 lib tests) green.
- New pins: `ungranted host call refused with the grant command`,
  `hostile string in a fixture is a note, executing fixture is capped at caution`,
  `README steps down, agent-facing one-liner does not`, `skills/ keeps full severity`,
  `legacy entry keeps what it declares`, `consented entry gets only the intersection`,
  `dropping a declaration removes the power`.
- clippy clean on the new code; the remaining warnings in `plugin_cli.rs`/`sidecar_tests.rs`
  are pre-existing test-target debt.

## Next

1. Shell hooks: `hooks:` in gray's config → subprocess, JSON on stdin/stdout, bounded
   `pre_tool_call` failing closed and observers failing open, off-path dispatch for slow
   hooks (the sidecar transport already has the bounded-queue pattern to copy).
2. `catalog.yaml` + `gray plugin search/browse/info` + `removed` list + `gray plugin pack`.
3. `session_start`/`session_end`, a per-turn context hook, `transform_tool_result` bounded to
   redact/truncate the current result only — never rewrite history, or the prompt-cache prefix
   breaks.
