# Plugin setup contract (`/gateway` setup) — design

Date: 2026-09-22 · Status: approved in chat · Branch: `feat/plugin-setup-contract`

## Problem

gray's app plugins each ship their own setup program, and nothing in core
drives or verifies them. The Discord plugin (0.2.0) is the worst case:

- `gray discord setup` is a dead end: the DM-pairing wait is stubbed
  (`gray-discord-plugin/src/cli.rs:202-205`, the callback always returns an
  error), so after the token and invite steps the wizard fails with
  "Pairing needs the gateway; run setup after first connect" and saves
  nothing.
- The wizard gates a first "hello" behind four budget/pricing questions and
  only accepts hidden token input on a real TTY, so no agent or headless
  flow can drive it. (This design removes the budget from the path
  entirely — see section 6.)
- Its service is systemd-user only; on a runit box every service verb fails
  with "systemctl failed".
- Core's only per-app knowledge is a hardcoded probe table
  (`crates/gray/src/repl/gateway_panel.rs:16`, `SETUP_PROBES`), so the
  `/gateway` panel can only ever know about plugins someone edited core to
  know about.

Net effect: setting up an app needs a TTY, a systemd box, and hand-written
JSON. The goal of this design: **one in-REPL flow, app-agnostic, where the only
manual steps are the ones only a human in a web portal can do. The flow
lives inside the existing `/gateway` connections panel — there is no new
top-level command.**

## Reference: the hermes logic being copied

`reference/NousResearch/hermes-agent` (read in full for this design):

1. `plugins/platforms/discord/plugin.yaml` declares `requires_env` /
   `optional_env` entries: `name`, `description`, `prompt`, `url` (the portal
   page), `password: true`.
2. `hermes_cli/config.py:3834` merges plugin declarations into a core
   registry at import; a hardcoded entry wins over a plugin-declared one.
   Core never needs to know a platform exists.
3. Secrets live in `.env` (never `config.yaml`), written by `save_env_value`;
   the wizard prompts masked and prints "Get your key at: <url>"
   (`hermes_cli/setup.py:339`).
4. Credential present = platform enabled
   (`gateway/config_env.py`, `_ENV_STEPS` `_Cred` rows); an explicit
   `enabled: false` still wins.
5. After setup, only already-running daemons are restarted, per init system
   (`systemd_restart` / `launchd_restart` / windows gateway,
   `hermes_cli/setup_platforms.py:282`); failures are reported, never fatal.

## Design

### 1. The declaration

A `setup` block per app. **v1: declared in core's `CATALOG` entry** in
`crates/gray/src/plugin_cli.rs` — same precedence rule as hermes (core entry
wins). **v2: plugins self-declare** through the sidecar `plugin/manifest`
wire (protocol 1.1 already exists; `gray-discord sidecar` serves it), merged
with core entries losing.

Schema (JSON, in the catalog entry):

```
setup: {
  config_path: "~/.config/<app>/config.json",   // app-owned file
  fields: [
    { key, kind, description, url?, secret?, default?, choices?, picker? }
    // kind: required | optional | derived
    //   required: user must supply (secret entries are masked, never logged)
    //   optional: user may supply; default may be empty
    //   derived:   gray fills it, no question (gray_bin, gray_home, workdir)
    // picker: "channels" — after the token verifies, offer the destination
    //         picker (section 5) instead of paste-an-ID
  ],
  verify: ["gray-<app>", "doctor"],   // run after writing; success = configured
  post_steps: ["register", "start"],  // ordered actions the flow performs
  service?: { argv: ["gray-<app>", "run"], name: "gray-<app>" }
}
```

The Discord v1 declaration, concretely:

- `config_path`: `~/.config/gray-discord/config.json`
- required: `token` (secret, url `https://discord.com/developers/applications`),
  `channel_id` ("the channel the bot posts to — paste a channel ID, or pick
  one below"), `owner_id` ("your Discord user ID; only gates who can trigger
  the bot — Developer Mode → Copy User ID")
- optional: `allowed_users`
- derived: `gray_bin` (current exe), `gray_home` (`~/.gray`), `workdir`
  (the config's directory)
- verify: `gray-discord doctor`
- post_steps: register `discord_send` into the plugin lock, then start

### 2. Registry and the panels

New module `crates/gray/src/setup/registry.rs`: load declarations, resolve
each app's config path, and compute state — *configured*, *needs setup
(which fields)*, *broken (verify fails)*. Presence checks read keys only;
values are never logged or rendered. This replaces `SETUP_PROBES`:

- `/gateway` app rows show `needs setup` or `broken — doctor fails`
  (one line, accurate for any app). Enter on such a row opens the setup
  flow; Enter on a configured row keeps today's toggle behavior.
- The manager loop (`setup/install_manager.rs`) gains one optional axis —
  a per-row `setup` action (a `ManagerItem` flag plus an optional closure
  on `run_install_manager`) — so `/gateway` can bind Enter to setup
  without `/skills`, `/plugins`, `/cron` or `/memory` changing at all.

### 3. The setup flow (inside `/gateway`)

In-REPL modal, reusing the `setup/connect.rs` machinery (the provider
connect flow is the exact template: pick → paste → verify → done):

1. The app row is already picked (Enter on a `needs setup` / `broken` row
   opens the flow); the missing fields are listed with their descriptions.
2. For each missing field: description, portal URL, and input — secret
   fields masked and never echoed, never sent to the model.
3. Derived fields filled silently.
4. Write the app's config atomically: directory `0700`, file `0600`, temp +
   rename (the same rules the plugin's own writer uses).
5. Run `verify`, show its real output. Failure is shown as failure; the
   flow never claims success the verify command did not report.
6. Run `post_steps`: register the outgoing tool into the plugin lock, then
   offer to start the daemon (section 4).

Headless twin: `gray gateway setup <app> --token … --channel-id …` (flags
or env for every non-derived field) — it sits in the existing
`gray gateway` command family. Same code path, non-interactive; error
messages never contain values (mirror the plugin's existing rule: "errors
never contain config values").

### 4. Start and supervision

Init probe, first hit wins: **systemd user → runit (`sv`) → launchd → none**.
"None" is the important one: gray starts the daemon itself as a background
job (gray already has background-job supervision), reports the PID, and
offers stop. Per-init failures are printed and non-fatal; the wizard never
exits non-zero because a restart failed.

### 5. Channel picker (in v1)

Once `token` verifies, a `channel`-kind field offers a picker instead of
paste-an-ID. The list is every destination the bot can actually post to:

- the guild's channels (for the originating request: guild
  `1544925612823547984` — snowflake IDs are time-ordered, so the newest
  channel is the highest ID and sorts first), and
- the DM channel between the bot and the owner (resolved through
  `POST /users/@me/channels` with the collected `owner_id`) — a DM is a
  perfectly good home channel, and it is the plugin's own historical
  default.

Only invoked when the declaration marks a field as a channel field; the
paste-an-ID path always remains for headless runs and for channels the
picker cannot see.

### 6. Companion change: the Discord plugin stops hard-requiring a budget

Setup writes no budget, so the daemon must start without one. Today
`gray-discord run` validates the policy against the model and sets
`budget_required` (`gateway.rs:382-384`), which fails startup. The plugin
change: validate only when a policy is present, and set
`budget_required = policy.is_some_and(...)` — absent budget means no
ledger and no spend gate, with `gray discord budget set` remaining as the
opt-in accounting path. This lives in the plugin repo
(`/home/vstaln/grayplugins/gray-discord-plugin`), lands as part of this
effort, and is the only plugin change v1 needs.

### 7. Explicitly out of scope for v1

- Pairing automation (the stubbed wizard path): deferred. `owner_id` is a
  plain required field for now; the plugin's dead pairing code is bypassed,
  not fixed. A follow-up either implements the gateway-event wait or deletes
  the dead path.
- Invite / Message Content Intent automation: gray prints the invite URL
  after the token verifies; portal steps stay manual.
- Slack/Telegram (or any second app): the registry makes them cheap, but v1
  ships Discord only.
- Plugin self-declaration via manifest: v2 (section 1).

### 8. Testing

- Unit: registry merge and precedence; the new manager action axis (Enter
  routes to setup for flagged rows, toggle is unchanged elsewhere); missing/present/derived field state;
  config-write shape (0600, atomic rename, tmp cleanup); secret redaction on
  every output and error path; init-probe selection table (including "none").
- Byte-stability prompt/UI tests per repo convention for the new modal
  states.
- Integration, on this box, with a real token: `/gateway` → Enter on the
  discord row → flow completes → doctor passes → daemon runs under the
  "none" supervisor → `discord_send` posts to the configured channel. Requires the user's bot token and the bot invited
  to the guild.

### 9. Risks

- Core writes another app's config file. Mitigation: the app's own loader
  validates on every start, and `verify` runs immediately after the write;
  a bad write surfaces as a doctor failure, never silent corruption.
- Secret hygiene. Mitigation: `0600` files, no logging of values, masked
  input, no value in any error string, nothing credential-shaped enters the
  model's context.
- XDG/path assumptions: resolve `~/.config` per platform; `workdir` sits
  next to the config file.
