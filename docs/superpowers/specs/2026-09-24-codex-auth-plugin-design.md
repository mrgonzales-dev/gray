# Codex auth plugin design

- **Date:** 2026-09-24
- **Status:** Approved design
- **Supersedes:** None

## Summary

Gray will add a provider-agnostic authentication contract for sidecar plugins. The first
consumer is a first-party `codex-auth` plugin that signs into a ChatGPT subscription and
uses the Codex Responses endpoint.

The plugin is optional. It appears in a catalog, but Gray does not install or enable it
automatically. After `gray plugin install codex-auth`, `/connect` discovers the plugin's
provider declaration and offers Codex subscription login beside the existing OpenAI API-key
option.

Gray core will not branch on Codex, OpenAI OAuth, or a particular OAuth endpoint. The
plugin owns those details. Gray owns consent, credential persistence, refresh coordination,
provider selection, and dispatch through a declared transport profile.

## Goals

- Add ChatGPT subscription authentication for Codex models through an installable Gray
  sidecar.
- Preserve the normal `/connect` flow and the existing OpenAI API-key path.
- Let any conforming plugin contribute an authenticated provider without adding a
  provider-specific branch to Gray core.
- Keep OAuth state, authorization codes, PKCE verifiers, access tokens, and refresh tokens
  out of prompts, model context, tool output, ordinary config, and logs.
- Support login, cancellation, expiry, refresh-token rotation, account changes, model
  discovery, logout, and plugin removal.
- Keep protocol 1.0 and 1.1 sidecars working unchanged.
- Credit the Apache-2.0 reference implementation and preserve its license obligations.

## Non-goals

- Proxying complete model streams through a sidecar.
- Adding an in-process dynamic Rust plugin ABI.
- Supporting arbitrary provider wire protocols in protocol 1.2. The first version defines
  one host transport adapter, `openai-responses`; later adapters can be added separately.
- Automatically installing `codex-auth`.
- Silently falling back from Codex subscription auth to an API key.
- Migrating, deleting, or reinterpreting legacy OAuth credentials.
- Synchronizing credentials through Gray Cloud.
- Running live ChatGPT login in CI.
- Adding a duplicate `/codex-login` command or overloading Gray's account `/login`; `/connect`
  is the v1 provider-login entry point.

## Approved decisions

1. `codex-auth` is a first-party sidecar plugin, not code linked into the Gray binary.
2. The plugin has a catalog entry and remains optional to install.
3. `/connect` discovers installed and enabled plugin providers at runtime.
4. Gray's support is provider-agnostic. Provider-specific OAuth, transport, and header
   policy stay in the plugin.
5. The first transport adapter is OpenAI Responses-compatible. Codex uses that adapter with
   a plugin-declared endpoint and header bindings.
6. Gray core owns credential persistence and refresh coordination.
7. The pinned first-party `codex-auth` package receives the
   `provider.credentials` capability automatically. Other plugins and all other capabilities
   keep the existing consent flow.
8. The implementation uses behavior from `vercel-labs/fx` under Apache-2.0 and records the
   source commit.

## Current Gray constraints

The current tree has pieces of an earlier OAuth design but no live subscription path:

- `SavedConfig.auth_mode` can hold `"oauth"`, but runtime code does not consume it.
- `~/.gray/auth.json` accepts API-key strings and a legacy `StoredAuth` object, but the
  normal model runtime resolves only a plaintext `config.api_key`.
- `OpenAiProvider` owns a static bearer token.
- Responses API routing is hard-coded for selected Muse models and endpoints.
- Request headers are fixed to bearer auth and session affinity. There is no generic
  metadata-bound header mechanism.
- A sidecar manifest can contribute tools, commands, hooks, and subcommands. It cannot yet
  contribute a model provider or receive credentials.
- `/connect` builds its provider list from the bundled provider catalog only.

These constraints mean a sidecar that only writes `auth.json` would produce a connected-looking
provider that the model runtime cannot use.

## Reference implementation and license

The behavioral reference is:

- Repository: `https://github.com/vercel-labs/fx`
- Local checkout: `/home/vstaln/gray/reference/vercel-labs/fx`
- Reference commit: `c95fcc66ada9bea4629f73199391c8a26438d760`
- License: Apache License 2.0

Relevant reference modules are:

- `src/core/auth/chatgpt_oauth.zig`
- `src/core/auth/chatgpt_session.zig`
- `src/core/auth/credentials.zig`
- `src/gateway/openai_codex.zig`
- `src/gateway/openai_codex_models.zig`
- `sdk/tests/test-term-login.mjs`

The reference uses browser authorization-code flow with PKCE, refresh-token rotation, an
account identifier extracted from the access token, a private versioned session file, and an
authenticated Codex Responses endpoint.

The implementation will include:

- A source notice on files whose behavior is adapted from the reference.
- The Apache-2.0 license text beside the plugin.
- An entry in `/home/vstaln/gray/THIRD_PARTY_NOTICES.md` naming the repository, license, and
  exact commit.

The public OAuth client identifier is configuration, not a secret. The implementation may
pin it as a non-secret constant, but logs and user-facing errors must not treat it as
sensitive.

## Architecture

```text
Installed sidecar manifest
        |
        v
Generic provider registry ----> /connect
        |                           |
        |                           v
        |                    active connection
        |                           |
        v                           v
Sidecar auth RPCs          declared provider profile
        |                           |
        v                           v
Credential store ----------> credential broker
                                    |
                                    v
                             model requests
```

### Plugin responsibilities

A provider plugin owns:

- Provider and auth-method identifiers, labels, and supported operations.
- OAuth discovery, authorization URL construction, PKCE, callback handling, token exchange,
  refresh, and optional remote revocation.
- Authenticated model discovery.
- Provider endpoints, transport selection, and credential-to-header bindings.
- Binding credential fields to transport headers.

The `codex-auth` plugin also owns ChatGPT-specific scopes, account-claim extraction, and
Codex request headers.

### Gray responsibilities

Gray owns:

- Package installation, enablement, capability grants, and manifest validation.
- A registry of provider declarations from installed and enabled sidecars.
- Merging those declarations into `/connect` without provider-specific branches.
- Private credential persistence, cross-process locking, atomic replacement, and strict
  reads.
- Active provider and auth selection in `config.json`.
- A credential broker that refreshes before expiry and coordinates concurrent callers.
- Model request construction through a validated transport profile.
- Safe user-facing errors and cleanup of credentials owned by an uninstalled plugin.

Gray does not own ChatGPT OAuth endpoints or Codex-specific header rules.

## Sidecar protocol 1.2

Protocol 1.2 extends the existing NDJSON request and response protocol. Older manifests
remain valid and do not need a `providers` field.

### Manifest declaration

A protocol-1.2 manifest may declare one or more providers:

```json
{
  "name": "codex-auth",
  "version": "0.1.0",
  "protocol": "1.2",
  "capabilities": ["provider.credentials"],
  "providers": [
    {
      "id": "codex",
      "name": "Codex",
      "transport": {
        "kind": "openai-responses",
        "base_url": "https://chatgpt.com/backend-api/codex",
        "authorization": {
          "kind": "bearer",
          "secret_name": "access_token"
        },
        "request": {
          "prompt_cache_key": false,
          "store": false,
          "include_reasoning_encrypted": true,
          "previous_response_id": false,
          "tool_choice": "auto",
          "parallel_tool_calls": true,
          "text_verbosity": "low"
        },
        "headers": [
          {
            "name": "chatgpt-account-id",
            "source": {
              "kind": "metadata",
              "name": "account_id"
            },
            "required": true
          },
          {
            "name": "originator",
            "value": "gray"
          },
          {
            "name": "OpenAI-Beta",
            "value": "responses=experimental"
          },
          {
            "name": "session-id",
            "source": {
              "kind": "session_id"
            },
            "required": true
          },
          {
            "name": "x-client-request-id",
            "source": {
              "kind": "session_id"
            },
            "required": true
          }
        ]
      },
      "auth_methods": [
        {
          "id": "chatgpt-subscription",
          "name": "ChatGPT subscription",
          "kind": "oauth",
          "operations": ["login", "refresh", "revoke", "models"]
        }
      ]
    }
  ]
}
```

Provider IDs are local to the plugin. Gray namespaces them as
`plugin-name:provider-id` for storage, conflict detection, and configuration.

### Validation

A provider declaration is valid only when all of these checks pass:

- Provider and auth-method IDs use a bounded lowercase slug format.
- Display names and IDs are non-empty and length-bounded.
- `base_url` is HTTPS, has no userinfo, query, or fragment, and has a valid host.
- `transport.kind` is supported by the running Gray version.
- `authorization.kind` is supported and references one secret name.
- Header names are valid HTTP field names.
- Header values contain no CR or LF and stay within the declared size limit.
- Header sources are limited to declared metadata fields and Gray's current session ID;
  arbitrary JSON paths and host environment lookups are not allowed.
- A header declares exactly one of `value` or `source`.
- Header names are unique within a provider, compared case-insensitively.
- Provider and auth-method IDs are unique within their manifest.
- A plugin cannot override `Host`, `Content-Length`, `Transfer-Encoding`, `Connection`,
  `Content-Type`, `Accept`, or `Authorization`. Authorization comes only from the validated
  authorization binding; content negotiation and body framing stay host-owned.
- Required metadata exists before a request starts.
- Request-policy fields use a closed allowlist. `store` may only be `false`;
  `tool_choice` is `auto` or `none`; `parallel_tool_calls` is boolean; and
  `text_verbosity` is `low`, `medium`, or `high`.
- Every declared auth operation has a corresponding protocol method.
- The complete manifest and serialized provider declaration fit within fixed size limits.

A malformed provider declaration disables that provider and emits a redacted warning. It
does not break unrelated plugin tools, commands, hooks, or built-in providers.

### Capability and trust

The new capability id is:

```text
provider.credentials
```

It permits a plugin to:

- Contribute providers to `/connect`.
- Receive stored credential material during refresh, revocation, and authenticated model
  discovery.
- Return replacement credentials after a successful login or refresh.

Gray's compiled first-party catalog marks the pinned `codex-auth` package as trusted for this
one capability. The automatic grant applies only when the resolved package name and SHA-256
match that compiled catalog entry; a custom index cannot inherit the grant. Trust comes from
Gray's catalog, never from a plugin self-declaration. The automatic grant applies only to
`provider.credentials`; `host.turn`, `host.ask`, `host.say`, `tool.override`, and every other
capability still require their normal grant.

Third-party providers require explicit consent. Non-interactive installation grants no
third-party provider capability.

## Provider RPCs

All RPCs use the existing request-id correlation and NDJSON transport. A plugin must never
write login prompts or protocol data to raw stdout.

### `provider/auth/start`

Input:

```json
{
  "provider": "codex",
  "auth_method": "chatgpt-subscription"
}
```

A successful start returns a pending operation immediately:

```json
{
  "operation_id": "opaque-id",
  "status": "pending",
  "verification_uri": "https://auth.openai.com/oauth/authorize?state=example",
  "expires_at": 1234567890,
  "retry_after_ms": 500
}
```

The host treats the operation ID and verification URI as sensitive because the URL carries
OAuth state. It opens the URI when possible and always displays it. If browser opening fails,
login continues and the user can open the URL manually.

The host allows at most five minutes for the whole operation. Sidecar and host clocks do not
need to agree; `retry_after_ms` controls polling cadence.

### `provider/auth/poll`

Input contains the `operation_id`. The result is one of:

- `pending`, with an optional bounded `retry_after_ms`;
- `completed`, with a credential payload;
- `failed`, with a safe machine-readable code and user-facing message;
- `cancelled`;
- `operation_lost`, if the sidecar restarted.

Gray treats unknown states as protocol errors and cancels the operation.

### `provider/auth/cancel`

Cancellation is best-effort. The host stops polling immediately. A later completion cannot
overwrite the credential selected by a newer login or a logout.

Each start operation has a monotonically increasing generation in the sidecar. Completing an
older generation returns `operation_lost` or is ignored by the sidecar.

### `provider/auth/refresh`

Input contains the provider ID, auth-method ID, profile binding, and current host-owned
credential envelope. A successful result contains a complete replacement credential payload.

Gray preserves the host-owned envelope fields and replaces the payload atomically. The plugin
may preserve an existing refresh token when the token endpoint omits a rotated one.

### `provider/auth/revoke`

Input contains the current credential. The result says whether the remote grant was revoked,
was unsupported, or failed. Gray deletes the local credential regardless of the remote result
or timeout.

### `provider/models`

Input contains provider and auth-method IDs, profile binding, and the current credential when
the model endpoint requires authentication. The result uses this shape:

```json
{
  "models": [
    {
      "id": "model-id",
      "name": "Model name",
      "context_window": 272000,
      "reasoning_efforts": ["off", "low", "medium", "high", "xhigh"]
    }
  ]
}
```

Unknown optional model fields are ignored. Required IDs are non-empty, unique, and
length-bounded. The response and each model name are size-bounded.

### Protocol limits

- Existing NDJSON frame limit: 256 KiB.
- Provider declarations inside one manifest: at most 64 KiB.
- Credential payload and stored plugin envelope: at most 128 KiB each.
- Complete `auth.json`: at most 4 MiB.
- Provider ID, auth-method ID, and operation ID: at most 64 UTF-8 bytes each.
- Display name, model ID, and model name: at most 256 UTF-8 bytes each.
- Base URL: at most 2,048 UTF-8 bytes.
- Static or metadata-bound header value: at most 4,096 UTF-8 bytes.
- Secret or metadata map: at most 64 entries.
- Individual secret value: at most 64 KiB.
- Individual metadata value: at most 4 KiB.
- Model list: at most 1,000 unique models.
- Safe plugin error code: at most 64 UTF-8 bytes.
- Safe plugin error message: at most 4 KiB.
- Poll interval: 250 to 5,000 milliseconds.

### Deadlines

- Login start: 10 seconds.
- Each poll: 10 seconds.
- Whole login operation: 5 minutes.
- Refresh: 30 seconds.
- Model discovery: 30 seconds.
- Revocation: 10 seconds.

Host and plugin shutdown cancels active operations. A sidecar exit produces an actionable
error and never blocks the UI thread.

## Credential envelope

A plugin completes login or refresh with only credential-owned data:

```json
{
  "secrets": {
    "access_token": "test-access-token",
    "refresh_token": "test-refresh-token"
  },
  "metadata": {
    "account_id": "acct_test"
  },
  "expires_at": 1234567890
}
```

Gray wraps that result in a host-owned stored envelope:

```json
{
  "version": 1,
  "plugin": "codex-auth",
  "provider": "codex",
  "auth_method": "chatgpt-subscription",
  "profile_binding": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "credential": {
    "secrets": {
      "access_token": "test-access-token",
      "refresh_token": "test-refresh-token"
    },
    "metadata": {
      "account_id": "acct_test"
    },
    "expires_at": 1234567890
  }
}
```

The plugin never supplies or chooses the host-owned identity or binding fields. Gray adds
them only after the plugin, provider, auth method, active declaration, and returned
credential schema match.

Rules:

- Stored plugin, provider, auth method, and profile binding must match the active
  declaration.
- `secrets` and `metadata` are bounded string maps.
- Only names referenced by the active provider profile may be used for request headers.
- Metadata bound to a header must pass the same CR/LF and length checks as a static header.
- `expires_at` is Unix time in seconds. A missing value means the credential has no known
  expiry.
- Refresh preserves the host-owned envelope fields and replaces only the credential payload.
- Debug formatting for plugin results and stored envelopes never reveals secret or metadata
  values.
- Provider errors never echo request or response bodies.

Gray computes `profile_binding` by serializing the validated provider ID, auth-method ID,
transport kind, normalized base URL, authorization binding, request policy, and declared header sources
as canonical JSON with sorted object keys and case-insensitively sorted header names, then
taking SHA-256.
URL normalization lowercases scheme and host, removes the default port, trims one trailing
slash, and preserves the declared path. A changed binding invalidates the old credential and
requires a new login. This prevents a stale token from being sent to a changed endpoint or
interpreted through a changed header contract.

## Credential storage

Plugin credentials live in `/home/vstaln/.gray/auth.json` under a namespaced map key:

```text
plugin:codex-auth:codex:chatgpt-subscription
```

The existing file remains a mixed map:

- API-key providers keep their existing string values.
- Legacy `StoredAuth` objects remain readable and untouched.
- New plugin entries use a distinct `PluginCredential` variant.

All credential writers use one short-lived cross-process `auth.lock` for file mutation. The
writer performs a strict read-modify-write, preserves every valid existing entry, writes a
random temporary file in the same directory, syncs the file, atomically replaces the target,
and syncs the directory. Unknown or malformed entry shapes fail closed rather than being
silently retained. Network calls never run while `auth.lock` is held.

On Unix, Gray requires user-only directory and file permissions and refuses symlinks,
hardlinked credential files, non-regular files, and group or world access. On Windows, Gray
uses the user profile's existing access controls and the same create-new, atomic-replace
sequence.

Reads have a fixed maximum size. Missing files mean no credentials. Existing malformed,
oversized, insecure, or unexpected files fail closed; Gray never replaces them with an empty
store.

Lock files live in the verified private Gray directory, are created with no-follow semantics,
and use user-only permissions on Unix. If the platform cannot provide a cross-process advisory
lock, plugin credential operations fail closed; existing API-key providers remain usable.

`config.json` stores only:

```json
{
  "model": "selected-model",
  "auth_mode": "oauth",
  "credential_source": "plugin",
  "provider_id": "codex-auth:codex",
  "auth_ref": "plugin:codex-auth:codex:chatgpt-subscription"
}
```

`auth_mode` describes the authentication mechanism. The new `credential_source` describes
where Gray obtains it. Existing configs have no `credential_source`; Gray continues to infer
their current API-key, keyless, or legacy behavior. A plugin-backed OAuth connection sets
`auth_mode` to `oauth` and `credential_source` to `plugin`. A future plugin-backed API-key
method can set `auth_mode` to `api_key` without changing the source model.

`config.json` never stores token fields.

Existing CLI and environment API-key precedence remains unchanged for API-key connections.
When a saved plugin provider is active, generic API-key environment variables do not replace
its credential. The user changes connections through `/connect`.

## Dynamic credential broker

`OpenAiProvider` will stop treating its bearer token as immutable process configuration.
The host supplies a credential source based on the active provider profile.

Before each HTTP attempt, the provider asks the credential source for a lease. The source:

1. Loads the namespaced credential under the shared auth lock.
2. Verifies plugin, provider, auth method, and profile binding.
3. Returns the stored credential when it is valid beyond the refresh margin.
4. Starts one refresh when it is within 60 seconds of expiry.
5. Makes concurrent callers wait on that same refresh.
6. Validates and durably saves the replacement before returning it.
7. Applies declared authorization and header bindings for that attempt.

A valid credential may continue to be used until its actual expiry if the plugin is
temporarily unavailable. Once actual expiry passes, requests stop with a re-login message
rather than sending a known-expired token.

The provider resolves credentials independently for retries. A retry can therefore use a
newly rotated token without rebuilding the whole agent.

The broker registry is process-global and keyed by the namespaced auth reference. Every
provider instance in that process shares its singleflight state.

Cross-process refresh uses a per-auth-reference operation lease, not the auth-file mutation
lock. A process acquires the refresh lease, reloads and rechecks the current credential, sends
one refresh RPC, then acquires the short auth-file lock only for the replacement. Competing
processes wait on the operation lease and reuse the saved result. The refresh lease deadline
is 35 seconds, one second beyond the refresh RPC deadline; an OS-released advisory lock makes
a crashed holder recoverable.

## Provider sidecar lifecycle

`/connect` runs before an agent can be built, while later model requests need the same plugin
for refresh. Provider sidecars therefore have two bounded uses:

- The setup path starts the selected provider sidecar on demand for login and model
  discovery, then shuts it down after the operation or cancellation.
- An agent's credential source keeps a provider sidecar handle for that agent's lifetime so
  it can refresh without a plugin restart.

The setup handle and agent handle do not share in-memory login state. The host-owned
credential file is the only handoff. This keeps the protocol stateless across process phases
and avoids turning every tool or command sidecar into a resident daemon.

A sidecar exit invalidates pending operations. The next provider RPC may spawn one fresh
sidecar, but a login operation is never silently resumed after `operation_lost`. Agent
shutdown sends `plugin/shutdown` and then reaps the child. Setup cancellation does the same.

Interactive login, refresh, revoke, and logout also share a per-auth-reference operation
lease. Login takes the lease with a non-blocking five-minute attempt, so a second Gray process
reports that login is already in progress instead of creating competing OAuth callbacks.
Refresh, revoke, and logout use a 35-second timed attempt. Every lease is advisory and
process-scoped; termination releases it.

## `/connect` integration

`/connect` merges two provider sources:

1. The existing bundled API-key and keyless catalog.
2. Provider declarations from installed, enabled protocol-1.2 sidecars.

Plugin providers use namespaced IDs. Duplicate display names are allowed but remain visibly
distinct in errors and diagnostics.

The picker shows each auth method as a separate choice. For `codex-auth`, the choices are:

- `Codex` -> `ChatGPT subscription`
- the existing `OpenAI` -> `API key`

The OpenAI API-key entry remains available whether or not the plugin is installed.

Installed and enabled plugin metadata is probed and cached by the plugin manager. Install,
enable, update, and `gray plugin check` refresh the validated provider declarations. A stale
or malformed cache entry is ignored until the plugin is checked again.

After login, Gray asks the plugin for the model catalog and opens the normal model picker.
A model-list failure keeps the valid credential and reports a retryable error.

## Codex plugin behavior

The first-party plugin will live under `/home/vstaln/gray/plugins/codex-auth/` and run as a
Rust sidecar binary. It will not be linked into Gray's binary.

### Login

The plugin uses the reference flow:

- Authorization issuer: `https://auth.openai.com`
- Authorization endpoint: `https://auth.openai.com/oauth/authorize`
- Token endpoint: `https://auth.openai.com/oauth/token`
- Scopes: `openid profile email offline_access api.connectors.read api.connectors.invoke`
- Loopback callback path: `/auth/callback`
- Preferred callback ports: `1455`, then `1457`
- Overall login timeout: five minutes
- PKCE method: `S256`
- Authorization parameters: `response_type=code`, `id_token_add_organizations=true`,
  `codex_cli_simplified_flow=true`, and `originator=gray`

The authorization-code exchange sends `grant_type=authorization_code`, the pinned public
client ID, authorization code, PKCE verifier, and exact redirect URI. Refresh sends
`grant_type=refresh_token`, the pinned public client ID, and current refresh token.

The plugin binds only to loopback. It generates cryptographically random state and verifier
values, validates the callback path and exact state, rejects fragments, and never logs the
authorization code, verifier, or token response.

The callback page contains only success or failure text. It never displays credentials.

### Account identity

The plugin extracts `chatgpt_account_id` from the namespaced access-token claim used by the
reference implementation. The value must be non-empty, length-bounded, and safe for an HTTP
header. The plugin validates token shape and decodes the claim but does not treat the claim as
a signature-verified authorization decision; the token itself came from the pinned HTTPS token
endpoint.

Gray binds that metadata field to `chatgpt-account-id`. The plugin also sends the declared
`originator: gray` header.

### Refresh

The plugin refreshes within 60 seconds of expiry. It accepts a rotated refresh token or
preserves the current token when the response omits one.

A refresh response for a different account is rejected. The old session is retired and the
user must sign in again. Refresh-token expiry, reuse, invalidation, and `invalid_grant` are
terminal and require a new login.

### Models and requests

The plugin declares these Codex endpoints:

- Responses: `https://chatgpt.com/backend-api/codex/responses`
- Models: `https://chatgpt.com/backend-api/codex/models`

The host transport adds the bearer token, request-policy fields, and every other request
header declared by the validated profile. The Codex manifest declares the account ID,
`originator: gray`, the OpenAI beta header, and both session-ID headers. The host adds only
generic HTTP headers such as `Content-Type` and `Accept: text/event-stream`. There is no
Codex-specific default in the host transport. The current unconditional
`x-opencode-session` behavior moves into the existing built-in profiles; plugin transports
send only their declared session headers.
Credential-bound plugin requests do not follow HTTP redirects. A 3xx response is an error so
credentials cannot cross an unvalidated origin.

The implementation must verify the current Codex request and response contract against the
pinned reference and OpenAI Codex sources before release. The reference commit is the initial
contract, not permission to silently change production behavior.

### Logout and removal

Logout always removes the local credential. Codex remote revocation may be unsupported; in
that case the plugin returns a safe `unsupported` result immediately.

Uninstalling `codex-auth` removes every credential whose owner is that plugin. If the active
connection references one of those credentials, Gray clears the active provider, auth
reference, and model while preserving unrelated config and model history.

## Error handling

| Failure | Required behavior |
|---|---|
| Plugin absent | `/connect` shows existing providers only. |
| Plugin disabled | Its providers disappear; stored credentials remain until explicit logout or uninstall. |
| Malformed provider declaration | Omit that provider, warn safely, and keep other plugin surfaces working. |
| Callback ports busy | Try the next declared port; report a clear error if all fail. |
| User cancels or denies login | Leave every existing credential unchanged. |
| Login timeout | Cancel the operation and leave existing credentials unchanged. |
| Sidecar exits during login | Return `operation_lost`; do not hang. |
| Model discovery fails after login | Keep the credential and report a retryable error. |
| Refresh has a transient network error | Keep the previous credential until actual expiry. |
| Refresh is rejected or the account changed | Remove only that plugin credential and require login. |
| Plugin is unavailable near expiry | Use the token only until actual expiry, then fail with a re-login message. |
| Remote revoke fails | Delete locally and report remote failure separately. |
| Credential store is malformed or insecure | Fail closed and preserve the file. |
| Plugin uninstall removes the active credential | Clear the active connection and require `/connect`. |

No failure silently switches providers or authentication methods.

## Secret handling

- Secret-bearing RPC request and result bodies are never written to debug logs.
- Sidecars must not log raw NDJSON lines for provider credential methods.
- Host errors and plugin errors are size-bounded and secret-redacted.
- Access and refresh tokens never enter the model transcript, prompt context, command line,
  environment, or `config.json`.
- The callback server binds to loopback and returns no secret data.
- Temporary credential files use create-new semantics and mode `0600` on Unix.
- Owned secret buffers use the lightweight `zeroize` crate and are zeroed on drop; Gray
  does not add a larger secret-management framework for this feature.
- Header values derived from credentials are validated before every request.
- A credential is bound to one provider profile and cannot be reused for another base URL.

## Testing strategy

### Protocol tests

- Parse protocol 1.0, 1.1, and 1.2 manifests.
- Ignore absent provider declarations on old plugins.
- Reject invalid URLs, slugs, header names, header values, auth bindings, request-policy
  values, sizes, and duplicate provider IDs.
- Verify unknown RPC states and oversized messages fail without hanging.
- Verify request-id correlation under out-of-order replies.
- Verify login polling, cancellation, operation generations, sidecar exit, and timeouts.
- Verify sensitive RPC bodies are absent from captured logs.

### Credential-store tests

- Preserve API-key and legacy OAuth entries during plugin writes.
- Reject corrupt, oversized, insecure, symlinked, hardlinked, and non-regular files.
- Verify strict read-modify-write under a cross-process lock, lock contention, and holder
  termination.
- Verify mode `0600`, directory privacy, atomic replacement, and no temporary-file residue.
- Verify uninstall removes only credentials owned by that plugin.
- Verify hand-redacted `Debug` output.
- Verify profile-binding changes require reauthentication.

### `/connect` tests

Snapshot the picker with:

- no auth plugin;
- plugin installed and disabled;
- plugin installed and enabled;
- Codex subscription plus OpenAI API key;
- malformed provider manifest;
- duplicate provider display names;
- connected and expired credentials.

Prove that the existing API-key flow is byte-for-byte unchanged when the plugin is absent.

### Loopback integration tests

Use local servers to exercise:

- PKCE authorization URL construction without real credentials.
- Callback state mismatch, denial, malformed query, and port fallback.
- Token exchange and refresh-token rotation.
- Terminal refresh rejection and account change.
- Authenticated model discovery.
- Codex request headers, including bearer auth and account ID.
- Reject cross-origin redirects rather than forwarding credential headers.
- Responses SSE parsing and tool calls.
- Headless `gray -p` using a previously selected plugin provider.
- Concurrent requests producing one refresh.
- Transient refresh failure retaining a valid credential.
- Plugin exit during login, refresh, and model discovery.

### End-to-end verification

CI uses no real ChatGPT account. Before release, maintainers perform one manual browser login
against the real endpoints, choose a model, run a normal turn, wait through one refresh, log
out, and confirm local credential deletion. That check is never a substitute for deterministic
loopback tests.

## Compatibility and migration

- Existing API-key providers keep their current configuration fields and precedence.
- Existing legacy `StoredAuth` objects remain readable and untouched.
- New plugin credentials use namespaced keys and a distinct store variant.
- Every valid API-key, legacy OAuth, and plugin entry remains unchanged during a valid
  read-modify-write. Unknown or malformed entry shapes fail closed.
- Unknown fields in `config.json` keep the existing behavior: they are ignored on read and
  are not promised to survive a rewrite.
- No automatic migration converts a legacy token into a plugin credential.
- A plugin-provider connection stores a provider reference instead of duplicating its base
  URL or secrets in `config.json`.
- Protocol 1.0 and 1.1 plugins continue loading through the existing path.

## Definition of done

- `gray plugin install codex-auth` installs a checksum-verified first-party package.
- The package is optional and appears in the plugin catalog before installation.
- `/connect` shows Codex subscription only while the plugin is installed and enabled.
- The OpenAI API-key option remains available and unchanged.
- Browser PKCE login, cancellation, timeout, callback fallback, and safe errors work.
- Tokens are stored only in the namespaced private `auth.json` entry.
- `config.json` contains no secret material.
- Model discovery and a normal Codex model turn work through the declared Responses profile.
- Refresh happens once within the expiry margin, survives concurrency, and persists rotated
  credentials before use.
- Terminal refresh rejection and account change require a new login.
- Logout always deletes local credentials.
- Uninstall removes plugin-owned credentials and clears a dangling active connection.
- Missing, disabled, malformed, crashed, and insecure states fail safely without affecting
  unrelated providers or credentials.
- Protocol 1.0 and 1.1 compatibility tests pass.
- Loopback tests cover OAuth, refresh, model discovery, headers, and Responses SSE.
- Secret-leak tests cover logs, errors, prompts, config, and callback output.
- Apache-2.0 attribution, license text, and the pinned commit are present.
- Focused crate tests, workspace tests, formatting, and clippy pass.

## Expected ownership boundaries

Implementation should preserve these module boundaries:

- `crates/gray-plugin`: protocol types, manifest parsing, sidecar RPC methods, capability
  id, validation, and transport redaction.
- `crates/gray-core`: credential-source interface plus secret-safe material, envelope,
  and lease types.
- `crates/gray-provider`: profile-driven OpenAI-compatible request construction and dynamic
  authorization.
- `crates/gray`: provider registry, credential store, process-global refresh broker,
  provider-sidecar lifecycle, `/connect` merge, config selection, browser opening, and
  user-facing errors.
- `plugins/codex-auth`: ChatGPT OAuth, Codex model discovery, provider declaration, and
  sidecar protocol implementation.
- `plugins/index.json` and plugin release tooling: package and catalog metadata.
- `docs/plugins.md` and `THIRD_PARTY_NOTICES.md`: installation, security, and attribution.

No implementation module should put a Codex-specific conditional in the generic provider
registry, credential broker, or `/connect` merge.
