# Codex Auth Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional, first-party `codex-auth` sidecar that signs into a ChatGPT subscription from `/connect`, persists credentials only in Gray's private auth store, refreshes them safely, and runs Codex models through Gray's existing OpenAI Responses adapter.

**Architecture:** Protocol 1.2 lets a sidecar declare a provider, its auth methods, a bounded request policy, and credential-to-header bindings. Gray validates and caches those declarations, owns the credential file and refresh broker, and passes a dynamic credential source plus a profile into `OpenAiProvider`; the plugin owns ChatGPT OAuth, account-claim extraction, model discovery, and the Codex declaration.

**Tech Stack:** Rust 1.91, Tokio, Reqwest with rustls, Axum loopback callback server, Serde/serde_json, SHA-256, `zeroize`, Ratatui/Crossterm, NDJSON sidecars, Wiremock/loopback TCP tests, GitHub Actions.

**Spec:** `/home/vstaln/gray/docs/superpowers/specs/2026-09-24-codex-auth-plugin-design.md`

## Global Constraints

- `codex-auth` is optional and appears in the plugin catalog before installation; Gray never auto-installs or silently falls back to it.
- `/connect` is the only v1 provider-login UI. Do not add `/codex-login` or overload Gray's account `/login`.
- Protocol 1.0 and 1.1 plugins remain valid. Protocol 1.2 adds provider declarations and six provider RPCs.
- The verified default official index may auto-grant only `provider.credentials` for `codex-auth`. A custom `GRAY_PLUGIN_INDEX` and every third-party plugin keep explicit consent.
- Gray core contains no Codex/OpenAI OAuth conditional. Codex endpoints, claims, scopes, and header values live under `/home/vstaln/gray/plugins/codex-auth/`.
- Gray owns `auth.json`, strict locking, atomic replacement, profile binding, refresh singleflight, and local logout. The plugin never writes Gray's credential or config files.
- Access and refresh tokens never enter prompts, model context, tool output, environment variables, `config.json`, logs, or user-visible errors.
- Credential-bearing plugin requests use a profile with redirects disabled. Header-bound metadata is revalidated on every HTTP attempt.
- The Codex profile sends the current reference-compatible Responses policy: no `prompt_cache_key`, `store: false`, encrypted reasoning content when reasoning is active, no `previous_response_id`, `tool_choice: "auto"`, `parallel_tool_calls: true`, and `text.verbosity: "low"`.
- The refresh margin is 60 seconds. Login start/poll deadlines are 10 seconds each, whole-login deadline is 5 minutes, refresh/model discovery are 30 seconds, and revoke is 10 seconds.
- Existing NDJSON frames stay at 256 KiB. Provider declarations are at most 64 KiB; credential payloads and stored envelopes are at most 128 KiB each; `auth.json` is at most 4 MiB. The Codex plugin returns at most 128 models from at most 192 KiB of HTTP response bytes.
- The first account-claim namespace is `https://api.openai.com/auth`; the plugin extracts `chatgpt_account_id` only after validating token shape and header safety. It does not treat the unverified claim as an authorization decision.
- Use `zeroize` for owned secret buffers. All credential and envelope `Debug` implementations are hand-redacted.
- Credit `https://github.com/vercel-labs/fx`, Apache-2.0, commit `c95fcc66ada9bea4629f73199391c8a26438d760`, in the plugin and `/home/vstaln/gray/THIRD_PARTY_NOTICES.md`.
- CI uses loopback fixtures only. A real ChatGPT login is a maintainer-only release check and requires the operator's browser.
- Work on the existing rolling branch and open PR. Do not create a second branch or PR. Before each task, run `git status --short` and `git diff --stat`; stop on overlapping dirty files or a branch moved by a sibling agent.
- Use `CARGO_BUILD_JOBS=4`. Run focused crate tests during iteration; run `cargo fmt --check`, `cargo clippy --workspace -- -D warnings`, and `cargo test --workspace` once before handoff.

## File Map

### New focused modules

- `/home/vstaln/gray/crates/gray-core/src/credential.rs` — secret-safe credential material, lease, source trait, and errors.
- `/home/vstaln/gray/crates/gray-core/src/credential_tests.rs` — redaction and credential-source contract tests.
- `/home/vstaln/gray/crates/gray-plugin/src/provider.rs` — protocol 1.2 provider declarations, validation, RPC payloads, model catalog, and profile binding.
- `/home/vstaln/gray/crates/gray-plugin/src/provider_tests.rs` — declaration validation and compatibility tests.
- `/home/vstaln/gray/crates/gray-plugin/testdata/provider_plugin.sh` — protocol fixture used only by sidecar tests.
- `/home/vstaln/gray/crates/gray-provider/src/openai_profile.rs` — wire/auth/header/request policy consumed by `OpenAiProvider`.
- `/home/vstaln/gray/crates/gray/src/auth/mod.rs` — auth-store/broker exports.
- `/home/vstaln/gray/crates/gray/src/auth/store.rs` — mixed legacy/API-key/plugin credential store, private files, and locks.
- `/home/vstaln/gray/crates/gray/src/auth/store_tests.rs` — permissions, corruption, preservation, and uninstall tests.
- `/home/vstaln/gray/crates/gray/src/auth/broker.rs` — process-global singleflight and cross-process refresh coordination.
- `/home/vstaln/gray/crates/gray/src/auth/broker_tests.rs` — concurrency, rotation, terminal failure, and account-change tests.
- `/home/vstaln/gray/crates/gray/src/providers/mod.rs` — provider host exports.
- `/home/vstaln/gray/crates/gray/src/providers/registry.rs` — validated manifest cache and installed-provider lookup.
- `/home/vstaln/gray/crates/gray/src/providers/runtime.rs` — sidecar-backed `ProviderRpc` plus process lifecycle.
- `/home/vstaln/gray/crates/gray/src/providers/catalog.rs` — API-key/plugin model-catalog dispatch and metadata caching.
- `/home/vstaln/gray/crates/gray/src/providers/tests.rs` — registry, runtime, and catalog tests with fake RPC.
- `/home/vstaln/gray/crates/gray/src/setup/provider_auth.rs` — `/connect` login state machine and best-effort revoke.
- `/home/vstaln/gray/crates/gray/src/setup/provider_auth_tests.rs` — cancel, timeout, persistence, and model-failure tests.
- `/home/vstaln/gray/plugins/codex-auth/Cargo.toml` — sidecar package manifest.
- `/home/vstaln/gray/plugins/codex-auth/src/main.rs` — NDJSON dispatch and sidecar lifecycle.
- `/home/vstaln/gray/plugins/codex-auth/src/manifest.rs` — protocol 1.2 Codex provider declaration.
- `/home/vstaln/gray/plugins/codex-auth/src/oauth.rs` — PKCE URL, token exchange, refresh, and JWT account claim.
- `/home/vstaln/gray/plugins/codex-auth/src/callback.rs` — loopback-only callback server and pending operation state.
- `/home/vstaln/gray/plugins/codex-auth/src/models.rs` — bounded Codex model fetch/parser.
- `/home/vstaln/gray/plugins/codex-auth/src/tests.rs` — loopback OAuth, refresh, model, and dispatch tests.
- `/home/vstaln/gray/plugins/codex-auth/plugin.sh` — source-tree conformance wrapper; release archives use native binaries.
- `/home/vstaln/gray/plugins/codex-auth/LICENSE-APACHE` — Apache-2.0 text copied from the reference.
- `/home/vstaln/gray/plugins/codex-auth/THIRD_PARTY_NOTICE.md` — module-level attribution and pinned commit.

### Existing files to modify

- `/home/vstaln/gray/Cargo.toml` — workspace dependency and plugin member.
- `/home/vstaln/gray/Cargo.lock` — resolved `zeroize` and plugin dependencies.
- `/home/vstaln/gray/crates/gray-core/Cargo.toml` and `/home/vstaln/gray/crates/gray-core/src/lib.rs` — credential module exports.
- `/home/vstaln/gray/crates/gray-plugin/Cargo.toml`, `/home/vstaln/gray/crates/gray-plugin/src/lib.rs`, `/home/vstaln/gray/crates/gray-plugin/src/capabilities.rs`, `/home/vstaln/gray/crates/gray-plugin/src/sidecar.rs`, `/home/vstaln/gray/crates/gray-plugin/src/sidecar_tests.rs`, and `/home/vstaln/gray/crates/gray-plugin/src/builder.rs` — manifest, capability, sensitive RPCs, fixture, and dynamic provider construction.
- `/home/vstaln/gray/crates/gray-provider/Cargo.toml`, `/home/vstaln/gray/crates/gray-provider/src/lib.rs`, `/home/vstaln/gray/crates/gray-provider/src/openai.rs`, and `/home/vstaln/gray/crates/gray-provider/src/openai_tests.rs` — profile-driven requests and credentials.
- `/home/vstaln/gray/crates/gray-pkg/src/index.rs`, `/home/vstaln/gray/crates/gray-pkg/src/ops.rs`, and their test modules — target binary selection, verified official-index auto-grants, and installed-entry access.
- `/home/vstaln/gray/crates/gray/src/lib.rs` and `/home/vstaln/gray/crates/gray/src/main.rs` — new auth/provider modules, package-install routing, capability grant flag, and plugin-backed build resolution.
- `/home/vstaln/gray/crates/gray/src/config.rs` and `/home/vstaln/gray/crates/gray/src/setup/catalog.rs` — plugin connection fields and auth-store re-exports.
- `/home/vstaln/gray/crates/gray/src/setup/connect.rs`, `/home/vstaln/gray/crates/gray/src/setup/connect_draw.rs`, `/home/vstaln/gray/crates/gray/src/setup/model_modal.rs`, and their tests — provider rows, async login state, model choice, and plugin-aware removal.
- `/home/vstaln/gray/crates/gray/src/setup/context/providers.rs` and model-cache call sites in `/home/vstaln/gray/crates/gray/src/repl/` — generic model-catalog dispatch.
- `/home/vstaln/gray/crates/gray/src/plugin_cli.rs`, `/home/vstaln/gray/crates/gray/src/plugin_check.rs`, and `/home/vstaln/gray/crates/gray/src/account.rs` — sidecar registration, cache refresh, grant command, provider conformance, and private writer reuse.
- `/home/vstaln/gray/plugins/index.json`, `/home/vstaln/gray/plugins/README.md`, `/home/vstaln/gray/.github/workflows/plugins-release.yml`, `/home/vstaln/gray/docs/plugins.md`, and `/home/vstaln/gray/THIRD_PARTY_NOTICES.md` — catalog, packaging, user docs, and attribution.

## Frozen Interfaces

These names are stable across tasks. Do not rename them mid-plan.

```rust
// gray-core
pub struct CredentialMaterial {
    pub secrets: SecretMap,
    pub metadata: BTreeMap<String, String>,
    pub expires_at: Option<u64>,
}

pub struct CredentialLease {
    pub secrets: SecretMap,
    pub metadata: BTreeMap<String, String>,
}

pub struct CredentialEnvelope {
    pub version: u8,
    pub plugin: String,
    pub provider: String,
    pub auth_method: String,
    pub profile_binding: String,
    pub credential: CredentialMaterial,
}

#[async_trait]
pub trait CredentialSource: Send + Sync {
    async fn acquire(&self) -> Result<CredentialLease, CredentialError>;
}

// gray-plugin
pub struct ProviderDecl {
    pub id: String,
    pub name: String,
    pub transport: ProviderTransportDecl,
    pub auth_methods: Vec<AuthMethodDecl>,
}

pub struct ProviderTransportDecl {
    pub kind: String,
    pub base_url: Url,
    pub authorization: ProviderAuthorizationDecl,
    pub request: ProviderRequestPolicyDecl,
    pub headers: Vec<ProviderHeaderDecl>,
}

pub struct ProviderAuthorizationDecl {
    pub kind: String,
    pub secret_name: String,
}

pub struct ProviderRequestPolicyDecl {
    pub prompt_cache_key: bool,
    pub store: bool,
    pub include_reasoning_encrypted: bool,
    pub previous_response_id: bool,
    pub tool_choice: Option<String>,
    pub parallel_tool_calls: Option<bool>,
    pub text_verbosity: Option<String>,
}

pub struct ProviderHeaderDecl {
    pub name: String,
    pub value: Option<String>,
    pub source: Option<ProviderHeaderSourceDecl>,
    pub required: bool,
}

// Header JSON uses `value` for static bindings and `source` for metadata/session
// bindings; exactly one of them is required.
pub enum ProviderHeaderSourceDecl {
    Static { value: String },
    Metadata { name: String },
    SessionId,
}

pub struct AuthMethodDecl {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub operations: Vec<String>,
}

pub struct ProviderAuthStart {
    pub operation_id: String,
    pub status: String,
    pub verification_uri: String,
    pub expires_at: u64,
    pub retry_after_ms: u64,
}

pub enum ProviderAuthPoll {
    Pending { retry_after_ms: Option<u64> },
    Completed(CredentialMaterial),
    Failed(ProviderRpcFailure),
    Cancelled,
    OperationLost,
}

pub struct ProviderRpcFailure {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    pub terminal: bool,
}

pub enum ProviderRpcError {
    CapabilityMissing(String),
    Protocol(String),
    Rpc(ProviderRpcFailure),
    Unavailable(String),
}

impl ProviderRpcError {
    pub fn protocol(message: impl Into<String>) -> Self;
}

pub struct ProviderRefreshRequest {
    pub provider: String,
    pub auth_method: String,
    pub profile_binding: String,
    pub credential: CredentialEnvelope,
}

pub struct ProviderRevokeRequest {
    pub provider: String,
    pub auth_method: String,
    pub profile_binding: String,
    pub credential: CredentialEnvelope,
}

pub struct ProviderModelsRequest {
    pub provider: String,
    pub auth_method: String,
    pub profile_binding: String,
    pub credential: CredentialEnvelope,
}

pub struct ProviderModelCatalog {
    pub models: Vec<ProviderModel>,
}

pub struct ProviderModel {
    pub id: String,
    pub name: String,
    pub context_window: Option<u32>,
    pub reasoning_efforts: Vec<String>,
}

// gray-provider
pub struct OpenAiProviderProfile {
    pub base_url: Url,
    pub wire: OpenAiWire,
    pub authorization: OpenAiAuthorization,
    pub headers: Vec<OpenAiHeader>,
    pub request: OpenAiRequestPolicy,
    pub follow_redirects: bool,
}

impl OpenAiProvider {
    pub fn new_with_profile(
        model: impl Into<String>,
        reasoning_effort: Option<String>,
        session_id: Option<String>,
        profile: OpenAiProviderProfile,
        credential_source: Arc<dyn CredentialSource>,
    ) -> Result<Self, String>;
}

// gray host
pub type StoredCredential = CredentialEnvelope;

pub struct InstalledProvider {
    pub plugin: String,
    pub provider: ProviderDecl,
    pub auth_method: AuthMethodDecl,
    pub profile_binding: String,
    pub argv: Vec<String>,
}
```

Fixture helpers named in task snippets are local to their test modules and have these contracts: `valid_provider_value()` returns the exact valid protocol-1.2 Codex-shaped declaration without operation claims; `valid_provider_decl()` returns its typed form; `invalid_transport()` contains a CRLF header; `legacy_auth()` returns `StoredAuth { provider: "legacy", expires_at: 1 }`; `stored_plugin_credential(secret)` returns a bound Codex envelope containing that one secret; `test_credential_envelope()` returns a matching envelope with `test-access`/`test-refresh`; and `sse_response()` returns an HTTP 200 `text/event-stream` body containing `[DONE]`. Registry, broker, package, and connect fixtures create isolated temp homes and return the concrete test struct shown by the consuming test; they never read or mutate the operator's real Gray home.

---

### Task 1: Add secret-safe core types and protocol 1.2 provider declarations

**Files:**
- Modify: `/home/vstaln/gray/Cargo.toml`
- Modify: `/home/vstaln/gray/crates/gray-core/Cargo.toml`
- Modify: `/home/vstaln/gray/crates/gray-core/src/lib.rs`
- Create: `/home/vstaln/gray/crates/gray-core/src/credential.rs`
- Create: `/home/vstaln/gray/crates/gray-core/src/credential_tests.rs`
- Modify: `/home/vstaln/gray/crates/gray-plugin/Cargo.toml`
- Modify: `/home/vstaln/gray/crates/gray-plugin/src/lib.rs:40-115`
- Create: `/home/vstaln/gray/crates/gray-plugin/src/provider.rs`
- Create: `/home/vstaln/gray/crates/gray-plugin/src/provider_tests.rs`
- Modify: `/home/vstaln/gray/crates/gray-plugin/src/capabilities.rs:75-110`

**Interfaces:**
- Consumes: existing `serde`, `async-trait`, `thiserror`, `sha2`, and `url::Url` with Serde through explicit crate dependencies.
- Produces: `CredentialMaterial`, `CredentialEnvelope`, `CredentialLease`, `CredentialSource`, `ProviderDecl`, `ProviderAuthStart`, `ProviderAuthPoll`, `ProviderModelCatalog`, `PROVIDER_CREDENTIALS_CAPABILITY` (alias of `PROVIDER_CREDENTIALS`), and `ProviderDecl::profile_binding`.

- [ ] **Step 1: Write core secret and source tests**

```rust
#[test]
fn credential_material_debug_redacts_every_value() {
    let value = CredentialMaterial {
        secrets: SecretMap::from_iter([("access_token", "test-access")]),
        metadata: BTreeMap::from([("account_id".into(), "acct_test".into())]),
        expires_at: Some(123),
    };
    let debug = format!("{value:?}");
    assert!(!debug.contains("test-access"));
    assert!(!debug.contains("acct_test"));
    assert!(debug.contains("redacted"));
}

#[tokio::test]
async fn credential_source_contract_returns_a_lease() {
    let source = StaticCredentialSource::new("access_token", "test-access");
    let lease = source.acquire().await.unwrap();
    assert_eq!(lease.secrets.get("access_token"), Some("test-access"));
}
```

- [ ] **Step 2: Run the core test and confirm the missing module failure**

Run:

```sh
CARGO_BUILD_JOBS=4 cargo test -p gray-core credential_tests -- --nocapture
```

Expected: FAIL because `gray_core::credential` and `CredentialSource` do not exist.

- [ ] **Step 3: Implement the core secret primitives**

Use `Zeroizing<String>` inside a custom serializable `SecretString`; do not use derived `Debug` or `Serialize` implementations that expose token values.

```rust
#[derive(Clone, Default, PartialEq, Eq)]
pub struct SecretMap(BTreeMap<String, SecretString>);

impl Debug for SecretMap {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        f.write_str("SecretMap(<redacted>)")
    }
}

#[derive(Debug, thiserror::Error)]
pub enum CredentialError {
    #[error("provider login required: {0}")]
    ReauthRequired(String),
    #[error("credential provider unavailable: {0}")]
    Unavailable(String),
    #[error("credential store rejected: {0}")]
    Store(String),
    #[error("credential rejected: {0}")]
    Invalid(String),
}

#[async_trait]
pub trait CredentialSource: Send + Sync {
    async fn acquire(&self) -> Result<CredentialLease, CredentialError>;
}

pub struct StaticCredentialSource {
    secret_name: String,
    secret: SecretString,
}

impl CredentialEnvelope {
    pub fn new(plugin: impl Into<String>, provider: impl Into<String>,
        auth_method: impl Into<String>, profile_binding: impl Into<String>,
        credential: CredentialMaterial) -> Result<Self, CredentialError>;
}

impl CredentialMaterial {
    pub fn empty() -> Self;
}

impl StaticCredentialSource {
    pub fn new(secret_name: impl Into<String>, secret: impl Into<String>) -> Self;
}
```

Add `zeroize = { version = "1.8", features = ["derive"] }` to `[workspace.dependencies]`, then use `zeroize.workspace = true` in `gray-core` and `gray-plugin`.

- [ ] **Step 4: Write failing manifest-isolation and validation tests**

```rust
#[test]
fn one_invalid_provider_does_not_hide_a_valid_peer() {
    let value = json!({
        "name": "provider-fixture",
        "version": "0.1.0",
        "protocol": "1.2",
        "capabilities": ["provider.credentials"],
        "providers": [
            {"id": "broken", "name": "Broken", "transport": invalid_transport()},
            valid_provider_value()
        ]
    });
    let manifest = Manifest::from_result(&value);
    assert_eq!(manifest.name, "provider-fixture");
    assert_eq!(manifest.providers.len(), 1);
    assert_eq!(manifest.providers[0].id, "good");
    assert_eq!(manifest.provider_errors.len(), 1);
}

#[test]
fn profile_binding_changes_when_request_policy_changes() {
    let a = valid_provider_decl();
    let mut b = a.clone();
    b.transport.request.parallel_tool_calls = Some(false);
    assert_ne!(a.profile_binding("chatgpt-subscription").unwrap(),
               b.profile_binding("chatgpt-subscription").unwrap());
}
```

Also cover absent providers on protocol 1.1, duplicate IDs, non-HTTPS/userinfo/query/fragment URLs, reserved and CRLF headers, unsupported request-policy values, the 64 KiB provider-declaration limit inside the existing 256 KiB frame.

- [ ] **Step 5: Implement typed declarations, per-provider validation, and canonical binding**

The manifest parser must parse the fixed fields once, then validate each provider independently. A manifest that declares providers under protocol 1.0 or 1.1 records a provider error and exposes zero providers; older tools/commands/hooks remain live. `ProviderTransportDecl.kind` accepts only `openai-responses` in 1.2.

```rust
pub struct Manifest {
    pub name: String,
    pub version: String,
    pub protocol: String,
    pub capabilities: Vec<String>,
    pub commands: Vec<String>,
    pub tools: Vec<ToolDef>,
    pub subcommands: BTreeMap<String, String>,
    pub hooks: Vec<String>,
    pub providers: Vec<ProviderDecl>,
    pub provider_errors: Vec<ProviderValidationError>,
}
```

Canonicalize an `OpenAiRequestPolicy`, normalized URL, auth binding, and case-sorted headers into deterministic JSON. Hash that JSON with SHA-256 and return `sha256:<64 lowercase hex>`. Implement redacted `Debug` for `CredentialMaterial`, `CredentialEnvelope`, `ProviderAuthStart`, every provider request containing an envelope, and `ProviderRpcFailure`; only bounded codes/messages may appear for the latter.

Add this capability description:

```rust
CapabilitySpec {
    id: "provider.credentials",
    label: "Provider credentials",
    description: "contribute /connect providers and receive stored credentials for login, refresh, revocation, and model discovery",
}
```

- [ ] **Step 6: Run both touched crates**

Run:

```sh
CARGO_BUILD_JOBS=4 cargo test -p gray-core credential_tests
CARGO_BUILD_JOBS=4 cargo test -p gray-plugin provider_tests
```

Expected: PASS.

- [ ] **Step 7: Commit the protocol and secret primitives**

```sh
git add Cargo.toml Cargo.lock crates/gray-core crates/gray-plugin
git commit -m "feat(plugin): add provider auth protocol types"
```

---

### Task 2: Add sensitive provider RPCs to the sidecar client

**Files:**
- Modify: `/home/vstaln/gray/crates/gray-plugin/src/sidecar.rs:259-746`
- Modify: `/home/vstaln/gray/crates/gray-plugin/src/sidecar_tests.rs`
- Create: `/home/vstaln/gray/crates/gray-plugin/testdata/provider_plugin.sh`

**Interfaces:**
- Consumes: all protocol 1.2 payload types from Task 1 and `SidecarPlugin::capabilities()`.
- Produces: `SidecarPlugin::{provider_auth_start, provider_auth_poll, provider_auth_cancel, provider_auth_refresh, provider_auth_revoke, provider_models}` and typed `ProviderRpcFailure`.

- [ ] **Step 1: Add a failing RPC fixture test**

The fixture must answer `plugin/manifest`, `plugin/shutdown`, and all six provider methods using only protocol 1.2 fields.

```rust
#[tokio::test]
async fn provider_rpcs_round_trip_without_shutdown() {
    let p = SidecarPlugin::spawn(vec!["testdata/provider_plugin.sh".into()])
        .await
        .unwrap();
    p.set_capabilities(vec![PROVIDER_CREDENTIALS_CAPABILITY.into()]);

    let started = p.provider_auth_start("codex", "chatgpt-subscription")
        .await
        .unwrap();
    assert_eq!(started.operation_id, "op-test");

    let completed = p.provider_auth_poll(&started.operation_id).await.unwrap();
    assert!(matches!(completed, ProviderAuthPoll::Completed(_)));

    let models = p.provider_models(&ProviderModelsRequest {
        provider: "codex".into(),
        auth_method: "chatgpt-subscription".into(),
        profile_binding: "sha256:test".into(),
        credential: test_credential_envelope(),
    }).await
    .unwrap();
    assert_eq!(models.models[0].id, "gpt-test");
}
```

- [ ] **Step 2: Run the fixture test and confirm missing methods**

```sh
CARGO_BUILD_JOBS=4 cargo test -p gray-plugin provider_rpcs_round_trip_without_shutdown -- --nocapture
```

Expected: FAIL because the provider client methods and fixture do not exist.

- [ ] **Step 3: Implement a sensitive transport path**

Add an internal request mode:

```rust
enum RequestSensitivity {
    Normal,
    Sensitive,
}
```

For `Sensitive`, log only method, frame size, elapsed time, and outcome. Never log params, result, error body, verification URI, or field names. Keep the existing 256 KiB frame limit and unknown-ID timeout.

Use exact deadlines:

```rust
pub async fn provider_auth_start(&self, provider: &str, auth_method: &str)
    -> Result<ProviderAuthStart, ProviderRpcError>;
pub async fn provider_auth_poll(&self, operation_id: &str)
    -> Result<ProviderAuthPoll, ProviderRpcError>;
pub async fn provider_auth_cancel(&self, operation_id: &str)
    -> Result<(), ProviderRpcError>;
pub async fn provider_auth_refresh(&self, request: &ProviderRefreshRequest)
    -> Result<CredentialMaterial, ProviderRpcError>;
pub async fn provider_auth_revoke(&self, request: &ProviderRevokeRequest)
    -> Result<ProviderRevokeResult, ProviderRpcError>;
pub async fn provider_models(&self, request: &ProviderModelsRequest)
    -> Result<ProviderModelCatalog, ProviderRpcError>;
```

Each method must require `provider.credentials` in `self.capabilities()` before writing a frame.

- [ ] **Step 4: Add sensitive-log and malformed-state tests**

Install a test-only `log::Log` capture and assert that request/response values containing `test-access`, `test-refresh`, and `state-test` never appear. Poll with unknown state and assert `ProviderRpcError::protocol("invalid provider auth state")`; never wait for another frame.

- [ ] **Step 5: Run sidecar tests**

```sh
CARGO_BUILD_JOBS=4 cargo test -p gray-plugin sidecar::tests
```

Expected: PASS, including old protocol fixtures.

- [ ] **Step 6: Commit the RPC client**

```sh
git add crates/gray-plugin/src/sidecar.rs crates/gray-plugin/src/sidecar_tests.rs crates/gray-plugin/testdata/provider_plugin.sh
git commit -m "feat(plugin): add sensitive provider rpc client"
```

---

### Task 3: Build the private mixed credential store and strict locks

**Files:**
- Create: `/home/vstaln/gray/crates/gray/src/auth/mod.rs`
- Create: `/home/vstaln/gray/crates/gray/src/auth/store.rs`
- Create: `/home/vstaln/gray/crates/gray/src/auth/store_tests.rs`
- Modify: `/home/vstaln/gray/crates/gray/src/lib.rs:20-45`
- Modify: `/home/vstaln/gray/crates/gray/src/setup/catalog.rs:333-515`
- Modify: `/home/vstaln/gray/crates/gray/src/account.rs:110-130`
- Modify: `/home/vstaln/gray/crates/gray/src/setup/catalog_tests.rs`
- Modify: `/home/vstaln/gray/crates/gray/src/setup/remove_tests.rs`

**Interfaces:**
- Consumes: `CredentialMaterial` and redacted secret maps from Task 1.
- Produces: `AuthEntry::{Key, OAuth, Plugin}`, the `StoredCredential = CredentialEnvelope` alias, `CredentialStore`, `AuthLock`, and strict atomic JSON helpers.

- [ ] **Step 1: Write failing mixed-store preservation tests**

```rust
#[test]
fn plugin_write_preserves_keys_and_legacy_oauth() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("auth.json");
    let mut store = BTreeMap::new();
    store.insert("openai".into(), AuthEntry::Key("sk-test".into()));
    store.insert("legacy".into(), AuthEntry::OAuth(legacy_auth()));
    CredentialStore::new(path.clone()).replace(&store).unwrap();

    let next = CredentialStore::new(path)
        .put_plugin(stored_plugin_credential("test-access"))
        .unwrap();
    assert!(matches!(next.get("openai"), Some(AuthEntry::Key(k)) if k == "sk-test"));
    assert!(matches!(next.get("legacy"), Some(AuthEntry::OAuth(_))));
    assert!(matches!(next.get("plugin:codex-auth:codex:chatgpt-subscription"),
                     Some(AuthEntry::Plugin(_))));
}
```

- [ ] **Step 2: Run the store test and confirm missing types**

```sh
CARGO_BUILD_JOBS=4 cargo test -p gray auth::store::tests::plugin_write_preserves_keys_and_legacy_oauth
```

Expected: FAIL because `CredentialStore` and `AuthEntry::Plugin` do not exist.

- [ ] **Step 3: Implement the store API without an async write callback**

```rust
pub enum AuthEntry {
    Key(String),
    OAuth(StoredAuth),
    Plugin(StoredCredential),
}

pub struct CredentialStore { path: PathBuf }

impl CredentialStore {
    pub fn new(path: PathBuf) -> Self;
    pub fn path(&self) -> &Path;
    pub fn load(&self) -> Result<BTreeMap<String, AuthEntry>>;
    pub fn replace(&self, next: &BTreeMap<String, AuthEntry>) -> Result<()>;
    pub fn put_plugin(&self, value: StoredCredential) -> Result<BTreeMap<String, AuthEntry>>;
    pub fn read_plugin(&self, auth_ref: &str) -> Result<Option<StoredCredential>>;
    pub fn replace_plugin_if_bound(&self, auth_ref: &str,
        expected_binding: &str, next: CredentialMaterial)
        -> Result<BTreeMap<String, AuthEntry>>;
    pub fn remove(&self, key: &str) -> Result<bool>;
    pub fn remove_plugin_owner(&self, plugin: &str) -> Result<usize>;
}
```

`CredentialEnvelope::new` computes identity from explicit arguments; it never trusts plugin-supplied identity fields.

- [ ] **Step 4: Implement fail-closed private-file operations**

Before plugin reads or writes:

- reject a missing parent that cannot be created as a user-only directory;
- reject symlinks, non-regular files, Unix hardlinks (`nlink != 1`), and group/world permissions;
- reject files larger than 4 MiB;
- use no-follow file opens on Unix and reparse-point-safe opens on Windows;
- acquire `auth.json.lock` with `File::try_lock`, retry for five seconds, and fail if advisory locking is unavailable;
- use `create_new` mode `0600` temporary files, file `sync_all`, atomic rename, and parent-directory sync;
- never hold the global auth lock across a network call.

Keep legacy `load_auth_keys()` tolerant for existing read-only UI paths; all plugin mutation uses strict `CredentialStore` methods. Never reinterpret a legacy `StoredAuth` as a plugin envelope, and never delete it during migration, refresh, or profile-binding changes.

- [ ] **Step 5: Add corruption, size, symlink, permission, and lock tests**

Cover malformed JSON, an unknown object entry, oversized input, a symlink, a two-link file on Unix, group-readable `auth.json`, a held lock timeout, and no temp-file residue. Add a Windows reparse-point test behind `#[cfg(windows)]`.

Add `#[serde(flatten)] extra: BTreeMap<String, serde_json::Value>` to `StoredAuth` and `CredentialEnvelope`; a valid legacy/plugin object keeps unknown fields through read-modify-write. An entirely unknown top-level entry shape still fails closed instead of being silently retained.

- [ ] **Step 6: Move private writer call sites without changing account behavior**

Expose `save_private_json` from `auth::store` and update `/home/vstaln/gray/crates/gray/src/account.rs` to call it directly. Re-export legacy auth types/functions from `setup::catalog` so existing tests and callers keep compiling.

- [ ] **Step 7: Run the Gray auth/setup tests**

```sh
CARGO_BUILD_JOBS=4 cargo test -p gray auth::store::tests
CARGO_BUILD_JOBS=4 cargo test -p gray setup::catalog::tests
CARGO_BUILD_JOBS=4 cargo test -p gray setup::remove::tests
```

Expected: PASS.

- [ ] **Step 8: Commit the credential store**

```sh
git add crates/gray/src/auth crates/gray/src/lib.rs crates/gray/src/setup/catalog.rs crates/gray/src/setup/catalog_tests.rs crates/gray/src/setup/remove_tests.rs crates/gray/src/account.rs
git commit -m "feat(auth): add private plugin credential store"
```

---

### Task 4: Verify official-index trust and register installed sidecars

**Files:**
- Modify: `/home/vstaln/gray/crates/gray-pkg/src/index.rs:20-58`
- Modify: `/home/vstaln/gray/crates/gray-pkg/src/ops.rs:13-60,301-390,1127-1310`
- Modify: `/home/vstaln/gray/crates/gray-pkg/src/index_tests.rs`
- Modify: `/home/vstaln/gray/crates/gray-pkg/src/ops_tests.rs`
- Modify: `/home/vstaln/gray/crates/gray/src/plugin_cli.rs:143-810`
- Modify: `/home/vstaln/gray/crates/gray/src/plugin_cli.rs:502-590`
- Modify: `/home/vstaln/gray/crates/gray/src/lib.rs:544-590`
- Modify: `/home/vstaln/gray/crates/gray/src/main.rs:220-285`

**Interfaces:**
- Consumes: verified `Report`, target binary path, `ProviderDecl`, and capability consent from Tasks 1-2.
- Produces: `plugin_cli::install_package`, `update_package_plugins`, `remove_package_plugin`, synchronized `gray-plugin::lock::LockFile`, and working `gray plugin capabilities <name> --all`.

- [ ] **Step 1: Write failing index trust tests**

```rust
#[test]
fn custom_index_cannot_auto_grant() {
    std::env::set_var(INDEX_URL_ENV, "http://127.0.0.1/index.json");
    let index = index_with_auto_grant("codex-auth", "provider.credentials");
    assert!(official_auto_grants(&index, "codex-auth").is_empty());
}

#[test]
fn target_binary_template_selects_this_host() {
    let root = Path::new("/pkg");
    let path = resolve_target_binary(root, "codex-auth/{target}/gray-codex-auth").unwrap();
    assert!(path.ends_with(target_triple()));
}
```

- [ ] **Step 2: Run package tests and confirm missing fields**

```sh
CARGO_BUILD_JOBS=4 cargo test -p gray-pkg official_index -- --nocapture
```

Expected: FAIL because `Entry` has no binary or auto-grant fields.

- [ ] **Step 3: Extend verified index entries and install reports**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub ecosystem: String,
    pub version: String,
    pub source: Source,
    pub hash: HashSpec,
    #[serde(default)]
    pub scope: String,
    #[serde(default)]
    pub binary: Option<String>,
    #[serde(default)]
    pub auto_grant_capabilities: Vec<String>,
}

pub struct Report {
    pub name: String,
    pub version: String,
    pub path: PathBuf,
    pub auto_grant_capabilities: Vec<String>,
}
```

Populate `Report.auto_grant_capabilities` only when `index_url() == DEFAULT_INDEX_URL`, the source is a GitHub release under `vstaln/gray`, the tarball hash verifies, and the requested plugin name matches. Custom indexes and direct URLs return an empty list.

Use one normalized target directory such as `linux-x86_64`, `macos-aarch64`, or `windows-x86_64`; reject absolute paths, `..`, and more than one `{target}` placeholder. Append `.exe` to the selected basename on Windows and require the resolved file to remain inside the extracted package root.

- [ ] **Step 4: Add a failing registration test**

Create a temp home plus a fixture executable that reports a valid 1.2 manifest. Assert that official `provider.credentials` is granted without a prompt, a different declared capability is not auto-granted, and the resulting `gray-plugin` lock has a non-`None` `capabilities_hash`.

- [ ] **Step 5: Route package install/update/remove through sidecar registration**

Add:

```rust
pub async fn install_package(home: &Path, spec: NameOrUrl, force: bool)
    -> Result<Report, anyhow::Error>;
pub fn remove_package_plugin(home: &Path, name: &str) -> anyhow::Result<()>;
pub fn set_package_plugin_enabled(home: &Path, name: &str, on: bool)
    -> anyhow::Result<()>;
```

`install_package` must run the existing source scanner, boot the manifest with `SidecarPlugin::spawn`, validate declared capabilities, apply official auto-grants, prompt only for remaining capabilities, synchronize the sidecar lock, and then refresh the provider cache from Task 5. Route `main.rs` through it and pass the existing `--force` flag to the scanner.

Add `runtime_role: RuntimeRole` to `gray_plugin::lock::LockEntry`, with `#[serde(default)] RuntimeRole::Full`. Set `ProviderOnly` only when a manifest has at least one valid provider and no tools, commands, subcommands, or hooks. Task 5 makes the normal plugin loader skip `ProviderOnly` entries, preventing a second resident Codex process beside the credential source's agent-lifetime handle.

On removal, delete plugin-owned credentials first, clear an active dangling config reference, remove package and sidecar locks, and invalidate the provider cache. If credential deletion fails, abort removal and preserve the install.

- [ ] **Step 6: Make capability grants actionable**

Extend the CLI variant:

```rust
Capabilities {
    name: Option<String>,
    #[arg(long)]
    all: bool,
}
```

With `--all`, intersect declared capabilities with the current manifest, store the new grant and consent hash, and refresh the provider cache. Without `--all`, preserve the existing report-only behavior.

- [ ] **Step 7: Run package and plugin-manager tests**

```sh
CARGO_BUILD_JOBS=4 cargo test -p gray-pkg
CARGO_BUILD_JOBS=4 cargo test -p gray plugin_cli::tests
```

Expected: PASS, including existing URL/index/scan behavior.

- [ ] **Step 8: Commit verified package registration**

```sh
git add crates/gray-pkg crates/gray/src/plugin_cli.rs crates/gray/src/lib.rs crates/gray/src/main.rs
git commit -m "feat(plugin): register verified provider packages"
```

---

### Task 5: Cache provider manifests and own the provider sidecar lifecycle

**Files:**
- Create: `/home/vstaln/gray/crates/gray/src/providers/mod.rs`
- Create: `/home/vstaln/gray/crates/gray/src/providers/registry.rs`
- Create: `/home/vstaln/gray/crates/gray/src/providers/runtime.rs`
- Create: `/home/vstaln/gray/crates/gray/src/providers/tests.rs`
- Modify: `/home/vstaln/gray/crates/gray/src/lib.rs`
- Modify: `/home/vstaln/gray/crates/gray/src/plugin_cli.rs:143-430,680-810`
- Modify: `/home/vstaln/gray/crates/gray/src/plugin_check.rs:35-80`
- Modify: `/home/vstaln/gray/crates/gray-plugin/src/lock.rs:15-50`
- Modify: `/home/vstaln/gray/crates/gray-plugin/src/builder.rs:339-470`
- Modify: `/home/vstaln/gray/crates/gray-plugin/tests/lock.rs`
- Modify: `/home/vstaln/gray/crates/gray-plugin/tests/builder_enabled.rs`
- Modify: `/home/vstaln/gray/crates/gray/src/plugin_native.rs`
- Modify: `/home/vstaln/gray/crates/gray/src/setup/install_manager_tests.rs`

**Interfaces:**
- Consumes: sidecar lock entries, `Manifest.providers`, `Manifest.provider_errors`, and Task 2 client methods.
- Produces: `ProviderRegistry::load_cached`, `refresh_plugin`, `InstalledProvider`, and `ProviderRpc`/`SidecarProviderRpc`.

- [ ] **Step 1: Write failing registry tests**

```rust
#[tokio::test]
async fn malformed_peer_is_omitted_without_hiding_valid_provider() {
    let fixture = provider_fixture("mixed-validity");
    let cache = refresh_plugin(&fixture.home, &fixture.lock_entry).await.unwrap();
    assert_eq!(cache.providers.len(), 1);
    assert_eq!(cache.providers[0].id, "codex-auth:codex");
    assert_eq!(cache.errors.len(), 1);
}

#[test]
fn disabled_project_entry_hides_cached_provider() {
    let registry = registry_fixture();
    assert!(registry.resolve("codex-auth:codex").is_some());
    disable_project_plugin("codex-auth");
    assert!(registry.resolve("codex-auth:codex").is_none());
}
```

- [ ] **Step 2: Run the registry test and confirm missing module**

```sh
CARGO_BUILD_JOBS=4 cargo test -p gray providers::tests::malformed_peer -- --nocapture
```

Expected: FAIL because `crate::providers` does not exist.

- [ ] **Step 3: Add a builder test proving a `ProviderOnly` lock entry never spawns through the normal tool/plugin loader, while a `Full` entry with the same manifest still does. Update every `LockEntry` literal in the listed test modules with the default `Full` role.

Implement the bounded provider cache**

```rust
#[derive(Clone, Serialize, Deserialize)]
pub struct ProviderCache {
    pub schema: u32,
    pub plugins: BTreeMap<String, CachedProviderPlugin>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct CachedProviderPlugin {
    pub identity: String,
    pub enabled: bool,
    pub manifest_sha256: String,
    pub providers: Vec<ProviderDecl>,
    pub errors: Vec<String>,
}
```

Store it at `<gray-home>/plugins/provider-cache.json`. Hash a canonical lock identity containing package name, version, package hash when present, and executable argv; never persist raw source URLs. A lock identity mismatch makes the cache stale and hides the provider until refresh.

`refresh_plugin` spawns the plugin, captures its manifest, sets granted capabilities, validates each provider independently, stores only valid declarations, and shuts the process down. Flatten each provider/auth-method pair into one `InstalledProvider`; require `provider.credentials` in the lock grant before exposing it. `ProviderRegistry::resolve(provider_id, auth_ref)` returns only when both namespaced IDs match. A malformed provider must not remove valid tools, commands, or hooks.

- [ ] **Step 4: Add the RPC abstraction and sidecar-backed implementation**

```rust
#[async_trait]
pub trait ProviderRpc: Send + Sync {
    async fn auth_start(&self, provider: &str, auth_method: &str)
        -> Result<ProviderAuthStart, ProviderRpcError>;
    async fn auth_poll(&self, operation_id: &str)
        -> Result<ProviderAuthPoll, ProviderRpcError>;
    async fn auth_cancel(&self, operation_id: &str) -> Result<(), ProviderRpcError>;
    async fn refresh(&self, request: ProviderRefreshRequest)
        -> Result<CredentialMaterial, ProviderRpcError>;
    async fn revoke(&self, request: ProviderRevokeRequest)
        -> Result<ProviderRevokeResult, ProviderRpcError>;
    async fn models(&self, request: ProviderModelsRequest)
        -> Result<ProviderModelCatalog, ProviderRpcError>;
    async fn shutdown(&self);
}
```

`SidecarProviderRpc` owns one `SidecarPlugin`. `ProviderRuntime::start` is used by setup and model discovery; `ProviderRuntime::for_agent` stays alive through the credential source. A child exit returns `operation_lost` or `unavailable`; only later non-login calls may respawn once.

- [ ] **Step 5: Wire cache refresh into install, update, enable, disable, and check**

After registration, refresh the cache. Enable/disable updates both lock files and removes/adds providers from the effective registry. `gray plugin check <installed-dir>` validates provider declarations even when no credential exists, but never starts browser login.

In `gray-plugin::builder::active_plugins`, skip user-lock entries whose `runtime_role` is `ProviderOnly` before spawning. Old lock files deserialize as `Full`, so existing tools/hooks/commands are unchanged. A mixed plugin that has both provider declarations and another runtime surface stays `Full`.

- [ ] **Step 6: Run registry and plugin-check tests**

```sh
CARGO_BUILD_JOBS=4 cargo test -p gray providers::tests
CARGO_BUILD_JOBS=4 cargo test -p gray plugin_check::tests
```

Expected: PASS.

- [ ] **Step 7: Commit the provider registry and runtime**

```sh
git add crates/gray/src/providers crates/gray/src/lib.rs crates/gray/src/plugin_cli.rs crates/gray/src/plugin_check.rs crates/gray/src/plugin_native.rs crates/gray/src/setup/install_manager_tests.rs crates/gray-plugin/src/lock.rs crates/gray-plugin/src/builder.rs crates/gray-plugin/tests
git commit -m "feat(plugin): cache installed provider declarations"
```

---

### Task 6: Add the refresh broker and dynamic credential source

**Files:**
- Create: `/home/vstaln/gray/crates/gray/src/auth/broker.rs`
- Create: `/home/vstaln/gray/crates/gray/src/auth/broker_tests.rs`
- Modify: `/home/vstaln/gray/crates/gray/src/auth/mod.rs`

**Interfaces:**
- Consumes: `CredentialStore`, `InstalledProvider`, `ProviderRpc`, and `CredentialSource`.
- Produces: `PluginCredentialSource`, `shared_plugin_source`, and process-global refresh singleflight.

- [ ] **Step 1: Write a failing concurrent-refresh test**

```rust
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_callers_share_one_rotation() {
    let fixture = broker_fixture("old-refresh");
    fixture.rpc.expect_refresh(1, "new-refresh");
    fixture.store.put_plugin(fixture.stored()).unwrap();

    let source = shared_plugin_source(fixture.installed(), fixture.store, fixture.rpc);
    let leases = tokio::join!(source.acquire(), source.acquire(), source.acquire());

    assert_eq!(fixture.rpc.refresh_calls().await, 1);
    for lease in leases {
        assert_eq!(lease.secrets.get("refresh_token"), Some("new-refresh"));
    }
}
```

The fixture credential expires inside the refresh margin.

- [ ] **Step 2: Run the broker test and confirm missing source**

```sh
CARGO_BUILD_JOBS=4 cargo test -p gray auth::broker::tests::concurrent_callers_share_one_rotation -- --nocapture
```

Expected: FAIL because `PluginCredentialSource` does not exist.

- [ ] **Step 3: Implement acquire/refresh ordering**

`acquire()` must:

1. read the strict namespaced entry;
2. verify plugin, local provider, auth method, and profile binding;
3. return a lease when expiry is beyond 60 seconds;
4. acquire a SHA-256-named per-auth-ref operation lock;
5. re-read and repeat expiry checks;
6. call `ProviderRpc::refresh` without holding the global auth lock;
7. validate and save the complete replacement under the global auth lock;
8. return a lease built from the saved material.

When expiry is unknown, use the stored credential. When actual expiry passes, return `CredentialError::ReauthRequired`; never send a known-expired token.

- [ ] **Step 4: Classify refresh failures**

Map `ProviderRpcFailure`:

- transient network, timeout, rate limit, or plugin unavailable: keep the old entry; return the stored lease only while it remains actually valid;
- `invalid_grant`, refresh reuse/invalidation, malformed account claim, or account change: remove only that namespaced entry and return `ReauthRequired`;
- profile mismatch: remove neither credential nor unrelated config; return `Invalid` and require `/connect` to repair the selection.

- [ ] **Step 5: Add tests for every failure class**

Cover one refresh across concurrent tasks, two Gray processes serialized by the per-ref lock, rotated refresh token persisted before return, omitted rotation token preserving the old value, transient failure retaining a valid token, actual expiry failing, terminal rejection deleting one entry, account change, and profile-binding change.

- [ ] **Step 6: Run auth tests**

```sh
CARGO_BUILD_JOBS=4 cargo test -p gray auth::tests
```

Expected: PASS.

- [ ] **Step 7: Commit the broker**

```sh
git add crates/gray/src/auth
git commit -m "feat(auth): coordinate plugin credential refresh"
```

---

### Task 7: Make the OpenAI adapter profile-driven and credential-aware

**Files:**
- Create: `/home/vstaln/gray/crates/gray-provider/src/openai_profile.rs`
- Modify: `/home/vstaln/gray/crates/gray-provider/src/lib.rs`
- Modify: `/home/vstaln/gray/crates/gray-provider/src/openai.rs:33-105,736-1010,1339-1385,1606-1770,2626-2690`
- Modify: `/home/vstaln/gray/crates/gray-provider/src/openai_tests.rs`

**Interfaces:**
- Consumes: `CredentialSource`, `CredentialLease`, and validated `ProviderTransportDecl`.
- Produces: `OpenAiProviderProfile`, `OpenAiProvider::new_with_profile`, and unchanged `OpenAiProvider::new` behavior for built-ins.

- [ ] **Step 1: Write failing Wiremock tests for the Codex profile**

```rust
#[tokio::test]
async fn codex_profile_uses_responses_policy_and_declared_headers() {
    let server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::path("/responses"))
        .and(wiremock::matchers::header("authorization", "Bearer test-access"))
        .and(wiremock::matchers::header("chatgpt-account-id", "acct_test"))
        .and(wiremock::matchers::header("originator", "gray"))
        .and(wiremock::matchers::header("session-id", "session-test"))
        .respond_with(sse_response())
        .expect(1)
        .mount(&server)
        .await;

    let provider = test_provider_with_codex_profile(server.uri());
    let _ = provider.stream(empty_request("gpt-test")).await;

    let request = server.received_requests().await.unwrap()[0].clone();
    let body: Value = serde_json::from_slice(&request.body).unwrap();
    assert_eq!(body["store"], false);
    assert_eq!(body["tool_choice"], "auto");
    assert_eq!(body["parallel_tool_calls"], true);
    assert_eq!(body["text"]["verbosity"], "low");
    assert!(body.get("prompt_cache_key").is_none());
    assert!(body.get("previous_response_id").is_none());
}
```

- [ ] **Step 2: Run the profile test and confirm the old hard-coded path fails**

```sh
CARGO_BUILD_JOBS=4 cargo test -p gray-provider codex_profile_uses_responses_policy -- --nocapture
```

Expected: FAIL because only the Muse/base-URL heuristic selects Responses and headers are hard-coded.

- [ ] **Step 3: Add exact profile types**

```rust
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OpenAiWire { Auto, ChatCompletions, Responses }

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OpenAiAuthorization { None, Bearer { secret_name: String } }

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OpenAiHeaderSource {
    Static(String),
    Metadata(String),
    SessionId,
}

#[derive(Clone, Debug, PartialEq)]
pub struct OpenAiHeader {
    pub name: String,
    pub source: OpenAiHeaderSource,
    pub required: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OpenAiRequestPolicy {
    pub prompt_cache_key: bool,
    pub store: bool,
    pub include_reasoning_encrypted: bool,
    pub previous_response_id: bool,
    pub tool_choice: Option<String>,
    pub parallel_tool_calls: Option<bool>,
    pub text_verbosity: Option<String>,
}
```

`OpenAiProvider::new` wraps its current API key in a static `CredentialSource` and uses an auto-wire/default-policy profile, preserving existing callers.

- [ ] **Step 4: Resolve credentials and headers once per HTTP attempt**

Change `send_json_once` to accept `&CredentialLease` and `&OpenAiProviderProfile`. For every retry:

- resolve the configured bearer secret;
- resolve each metadata/session/static header;
- reject missing required metadata;
- reject CR/LF and overlong values;
- add generic `Content-Type: application/json` and `Accept: text/event-stream`;
- build the URL from the profile's wire choice;
- redact all lease values from response snippets before constructing `ProviderError`.

Build a Reqwest client with `redirect(Policy::none())` when `follow_redirects` is false.

- [ ] **Step 5: Apply the closed Responses policy**

Serialize `prompt_cache_key` and `previous_response_id` only when enabled, keep `store: false`, add `tool_choice`, `parallel_tool_calls`, and `text.verbosity` only when declared, and retain encrypted reasoning replay only when enabled. The auto/default profile preserves the current cache/replay behavior.

- [ ] **Step 6: Add negative transport tests**

Cover missing account metadata, CRLF metadata, missing bearer secret, a 307 cross-origin redirect, a response body echoing the bearer token, a new credential on retry, explicit Chat Completions, and byte-for-byte existing default API-key headers.

- [ ] **Step 7: Run all provider tests unmodified**

```sh
CARGO_BUILD_JOBS=4 cargo test -p gray-provider
```

Expected: PASS.

- [ ] **Step 8: Commit the profile-driven transport**

```sh
git add crates/gray-provider
git commit -m "feat(provider): support declared credential profiles"
```

---

### Task 8: Resolve plugin connections in config, build_agent, and model discovery

**Files:**
- Modify: `/home/vstaln/gray/crates/gray/src/config.rs:36-195`
- Modify: `/home/vstaln/gray/crates/gray/src/setup/catalog.rs:57-115,248-285,333-350`
- Modify: `/home/vstaln/gray/crates/gray/src/lib.rs:169-250`
- Modify: `/home/vstaln/gray/crates/gray-plugin/src/builder.rs:652-770`
- Create: `/home/vstaln/gray/crates/gray/src/providers/catalog.rs`
- Modify: `/home/vstaln/gray/crates/gray/src/providers/mod.rs`
- Modify: `/home/vstaln/gray/crates/gray/src/providers/tests.rs`
- Modify: `/home/vstaln/gray/crates/gray/src/setup/context/providers.rs:473-550`
- Modify: `/home/vstaln/gray/crates/gray/src/setup/model_modal.rs:5-120`
- Modify: `/home/vstaln/gray/crates/gray/src/repl/mod.rs:425-480`
- Modify: `/home/vstaln/gray/crates/gray/src/repl/handlers.rs:530-600`
- Modify: `/home/vstaln/gray/crates/gray/src/repl/status.rs:390-420`
- Modify: `/home/vstaln/gray/crates/gray/src/cron_serve_tests.rs`
- Modify: `/home/vstaln/gray/crates/gray/src/repl/handlers_tests.rs`
- Modify: `/home/vstaln/gray/crates/gray/src/repl/session_tests.rs`
- Modify: `/home/vstaln/gray/crates/gray/src/setup/connect_draw_tests.rs`
- Modify: `/home/vstaln/gray/crates/gray/src/setup/remove_tests.rs`
- Modify: `/home/vstaln/gray/crates/gray/src/turn_caps_tests.rs`

**Interfaces:**
- Consumes: `ProviderRegistry`, `InstalledProvider`, `PluginCredentialSource`, and `OpenAiProviderProfile`.
- Produces: plugin-aware `Config`, `BuilderOptions::{provider_profile, credential_source}`, and one model-catalog dispatch helper.

- [ ] **Step 1: Write failing config precedence tests**

```rust
#[test]
fn saved_plugin_connection_ignores_generic_api_key_environment() {
    let home = tempdir().unwrap();
    save_plugin_saved_config(home.path());
    let cli = Cli::parse_from(["gray"]);
    let config = Config::resolve_with_in(home.path(), &cli, |key| {
        (key == "OPENAI_API_KEY").then(|| "sk-wrong".into())
    }).unwrap();

    assert_eq!(config.credential_source.as_deref(), Some("plugin"));
    assert_eq!(config.provider_id.as_deref(), Some("codex-auth:codex"));
    assert!(config.api_key.is_none());
}

#[test]
fn api_key_connection_keeps_existing_precedence() {
    let config = resolve_api_key_fixture("flag-key", "env-key", "saved-key");
    assert_eq!(config.api_key.as_deref(), Some("flag-key"));
    assert_eq!(config.credential_source, None);
}
```

- [ ] **Step 2: Run config tests and confirm missing fields**

```sh
CARGO_BUILD_JOBS=4 cargo test -p gray plugin_connection_ignores -- --nocapture
```

Expected: FAIL because `Config` has no provider fields.

- [ ] **Step 3: Add stable connection fields to saved and resolved config**

```rust
// SavedConfig and Config
pub auth_mode: Option<String>,
pub credential_source: Option<String>,
pub provider_id: Option<String>,
pub auth_ref: Option<String>,
```

The only recognized source value is `plugin`. When it is present, resolve `api_key` as `None` regardless of `OPENAI_API_KEY`; retain model overrides. Keep existing API-key and keyless behavior byte-for-byte. Add the fields to hand-redacted `Debug` without printing auth references in credential payloads.

Add `#[serde(flatten)] extra: BTreeMap<String, serde_json::Value>` to `SavedConfig`. In `partial_saved_config`, copy every unrecognized JSON object member into `extra`; serialize the map back on the next valid save. Add a test that hand-edits an unrelated field, reloads with a malformed optional known field, and confirms the unrelated field survives the resulting default-tolerant save.

- [ ] **Step 4: Resolve one `ProviderConnection` in `build_agent`**

```rust
pub struct ResolvedProviderConnection {
    pub profile: OpenAiProviderProfile,
    pub source: Arc<dyn CredentialSource>,
    pub installed: InstalledProvider,
}

pub async fn resolve_provider_connection(config: &Config)
    -> Result<Option<ResolvedProviderConnection>, anyhow::Error>;

pub fn resolve_with_in<F>(home: &Path, cli: &Cli, env: F) -> anyhow::Result<Config>
where
    F: FnMut(&str) -> Option<String>;
```

For a plugin connection, resolve the exact `provider_id` and `auth_ref`, compare the cached profile binding, create `SidecarProviderRpc`, create `shared_plugin_source`, acquire once to fail early, convert the validated declaration to `OpenAiProviderProfile`, and return it. Model metadata discovery is best-effort here: on failure, queue a safe profile warning and continue with the selected saved model plus cached/fallback context metadata. API-key configs return `None` and preserve the old path.

- [ ] **Step 5: Add optional dynamic fields to `BuilderOptions`**

```rust
pub struct BuilderOptions {
    // existing fields unchanged
    pub provider_profile: Option<OpenAiProviderProfile>,
    pub credential_source: Option<Arc<dyn CredentialSource>>,
}
```

When both are `Some`, force `profile.follow_redirects = false`, call `OpenAiProvider::new_with_profile`, and otherwise call the existing `OpenAiProvider::new`. The credential source owns the agent-lifetime sidecar, so dropping the agent shuts it down.

- [ ] **Step 6: Centralize model-catalog dispatch**

Add:

```rust
pub fn fetch_models_for_config(config: &Config) -> Vec<(String, String)>;
```

For API-key configs, call the existing live `/models` code. For plugin configs, acquire a current credential through the broker, call `ProviderRpc::models`, cache context windows and reasoning levels, and return IDs/names. Reuse this helper in model modal, REPL boot, model changes, and context reset; do not send plugin credentials to the generic `/models` HTTP client.

- [ ] **Step 7: Run config, provider-host, model-modal, and REPL tests**

```sh
CARGO_BUILD_JOBS=4 cargo test -p gray config::tests
CARGO_BUILD_JOBS=4 cargo test -p gray providers::tests
CARGO_BUILD_JOBS=4 cargo test -p gray setup::model_modal::tests
CARGO_BUILD_JOBS=4 cargo test -p gray repl::tests
```

Expected: PASS. - [ ] **Step 8: Commit config and build integration**

```sh
git add crates/gray/src/config.rs crates/gray/src/setup/catalog.rs crates/gray/src/lib.rs crates/gray-plugin/src/builder.rs crates/gray/src/providers crates/gray/src/setup/context/providers.rs crates/gray/src/setup/model_modal.rs crates/gray/src/repl
git commit -m "feat(provider): resolve plugin-backed model connections"
```

---

### Task 9: Merge plugin auth methods into `/connect`

**Files:**
- Create: `/home/vstaln/gray/crates/gray/src/setup/provider_auth.rs`
- Create: `/home/vstaln/gray/crates/gray/src/setup/provider_auth_tests.rs`
- Modify: `/home/vstaln/gray/crates/gray/src/setup/catalog.rs:518-580,611-735`
- Modify: `/home/vstaln/gray/crates/gray/src/setup/connect.rs:1-705`
- Modify: `/home/vstaln/gray/crates/gray/src/setup/connect_draw.rs:133-430`
- Modify: `/home/vstaln/gray/crates/gray/src/setup/connect_draw_tests.rs`
- Modify: `/home/vstaln/gray/crates/gray/src/setup/remove_tests.rs`
- Modify: `/home/vstaln/gray/crates/gray/src/setup/mod.rs:40-101`

**Interfaces:**
- Consumes: installed provider rows, `ProviderRpc`, `CredentialStore`, `fetch_models_for_config`, and `feedback::open_in_browser`.
- Produces: generic `ConnectAuth`, `PluginLoginUi`, provider-aware model choice, local logout, and active-config cleanup.

- [ ] **Step 1: Write failing provider-row and persistence tests**

```rust
#[test]
fn connect_rows_include_each_plugin_auth_method() {
    let catalog = catalog_fixture();
    let providers = vec![installed_provider("codex-auth:codex", "chatgpt-subscription")];
    let rows = build_connect_items(&catalog, &providers);
    assert!(rows.iter().any(|r| r.id == "codex-auth:codex"
        && matches!(r.auth, ConnectAuth::Plugin { .. })));
    assert!(rows.iter().any(|r| r.id == "openai" && r.auth == ConnectAuth::ApiKey));
}

#[test]
fn selecting_plugin_clears_api_key_and_writes_only_references() {
    let fixture = connect_config_fixture();
    activate_plugin(&mut fixture.config, &fixture.saved, &fixture.provider, "gpt-test").unwrap();
    assert_eq!(fixture.saved.api_key, None);
    assert_eq!(fixture.saved.auth_mode.as_deref(), Some("oauth"));
    assert_eq!(fixture.saved.credential_source.as_deref(), Some("plugin"));
    assert!(!serde_json::to_string(&fixture.saved).unwrap().contains("test-access"));
}
```

- [ ] **Step 2: Run connect tests and confirm the old item shape fails**

```sh
CARGO_BUILD_JOBS=4 cargo test -p gray setup::connect_rows_include -- --nocapture
```

Expected: FAIL because `build_connect_items` has no provider argument and `ConnectItem` has no `auth` enum.

- [ ] **Step 3: Add a generic connect auth enum**

```rust
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ConnectAuth {
    None,
    ApiKey,
    Plugin {
        auth_ref: String,
        profile_binding: String,
    },
}
```

`ConnectItem::is_connected` checks the namespaced plugin entry for `Plugin`, the existing key for `ApiKey`, and base URL for `None`. Keep duplicate display names but make errors use namespaced IDs.

- [ ] **Step 4: Implement the host-owned login state machine**

```rust
pub enum PluginLoginProgress {
    Started { verification_uri: String },
    Pending,
    CredentialSaved,
    Models(Vec<(String, String)>),
    ModelsUnavailable(String),
    Cancelled,
    Failed(String),
}

pub async fn run_plugin_login(
    provider: InstalledProvider,
    cancel: CancellationToken,
    progress: mpsc::UnboundedSender<PluginLoginProgress>,
) -> anyhow::Result<()>;
```

The state machine starts the sidecar, sends the URI, always calls existing `feedback::open_in_browser`, polls until completion/timeout, wraps the returned material in `CredentialEnvelope::new`, saves it before model discovery, and shuts down in every exit path. Cancellation calls `provider/auth/cancel`; a late completion cannot overwrite a newer login or a removed credential.

- [ ] **Step 5: Add nonblocking TUI state**

Add an `Authorizing` modal state that polls crossterm with a bounded timeout and drains `PluginLoginProgress` between events. Display the full verification URI and status, allow Esc to cancel, and never block the render loop for five minutes. Reuse the existing model-selection state after a successful save.

- [ ] **Step 6: Persist provider selection generically**

On model confirmation:

- plugin row: set `base_url` from the declaration, clear `api_key`, set `auth_mode` from the method kind, set `credential_source = plugin`, set namespaced provider/auth references, and save the model;
- API-key row: set existing key fields and clear all plugin references;
- keyless row: clear credentials and plugin references.

Use the saved-config lock across each read-modify-write and preserve unrelated fields/history.

- [ ] **Step 7: Make removal provider-aware**

Local removal deletes the exact auth entry immediately. For plugin auth, spawn best-effort remote revoke after local deletion and report its failure separately without restoring the token. If the removed entry is active, clear in-memory and saved provider/auth/model fields without changing another provider's history.

- [ ] **Step 8: Add controller and snapshot tests**

Cover absent/disabled/malformed plugin, multiple auth methods, duplicate names, start/poll/cancel, callback denial/timeout, sidecar exit, credential persistence before models, model-list failure, API-key flow unchanged, plugin removal, and active dangling-reference cleanup.

- [ ] **Step 9: Run connect tests**

```sh
CARGO_BUILD_JOBS=4 cargo test -p gray setup::provider_auth::tests
CARGO_BUILD_JOBS=4 cargo test -p gray setup::connect
CARGO_BUILD_JOBS=4 cargo test -p gray setup::connect_draw::tests
```

Expected: PASS. - [ ] **Step 10: Commit `/connect` integration**

```sh
git add crates/gray/src/setup
git commit -m "feat(connect): add plugin provider authentication"
```

---

### Task 10: Create the Codex OAuth and account-claim core

**Files:**
- Modify: `/home/vstaln/gray/Cargo.toml`
- Create: `/home/vstaln/gray/plugins/codex-auth/Cargo.toml`
- Create: `/home/vstaln/gray/plugins/codex-auth/src/lib.rs`
- Create: `/home/vstaln/gray/plugins/codex-auth/src/main.rs`
- Create: `/home/vstaln/gray/plugins/codex-auth/src/oauth.rs`
- Create: `/home/vstaln/gray/plugins/codex-auth/src/callback.rs`
- Create: `/home/vstaln/gray/plugins/codex-auth/src/tests.rs`
- Create: `/home/vstaln/gray/plugins/codex-auth/plugin.sh`

**Interfaces:**
- Consumes: `CredentialMaterial`, PKCE primitives, and the production endpoint constants pinned by the spec.
- Produces: `OAuthConfig`, `Pkce`, `LoginOperation`, `exchange_code`, `refresh`, and `account_id_from_access_token`.

- [ ] **Step 1: Add the package and failing RFC PKCE test**

```toml
[package]
name = "codex-auth"
version = "0.1.0"
edition = "2024"
rust-version = "1.91"
license = "MIT"
publish = false

[dependencies]
anyhow.workspace = true
async-trait.workspace = true
axum.workspace = true
base64.workspace = true
getrandom = "0.3"
gray-core.workspace = true
gray-plugin.workspace = true
reqwest.workspace = true
serde.workspace = true
serde_json.workspace = true
sha2.workspace = true
tokio.workspace = true
zeroize.workspace = true

[dev-dependencies]
tokio = { workspace = true, features = ["test-util"] }
```

Add `plugins/codex-auth` to workspace members. Add `getrandom = "0.3"` to workspace dependencies and use the workspace entry.

```rust
#[test]
fn pkce_s256_matches_rfc_7636_vector() {
    let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    assert_eq!(
        pkce_challenge(verifier).unwrap(),
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
}
```

- [ ] **Step 2: Run the plugin test and confirm the missing crate**

```sh
CARGO_BUILD_JOBS=4 cargo test -p codex-auth pkce_s256 -- --nocapture
```

Expected: FAIL because `pkce_challenge` and the OAuth module symbols are absent.

- [ ] **Step 3: Implement dependency-injected OAuth configuration and PKCE**

```rust
pub struct OAuthConfig {
    pub issuer: Url,
    pub client_id: String,
    pub callback_path: &'static str,
    pub callback_ports: [u16; 2],
    pub scopes: Vec<String>,
}

pub struct Pkce {
    pub state: Zeroizing<String>,
    pub verifier: Zeroizing<String>,
}
```

Production uses the exact issuer, public client ID, scopes, `/auth/callback`, and ports from the spec. The authorization query includes `response_type=code`, `codex_cli_simplified_flow=true`, `id_token_add_organizations=true`, and `originator=gray`. Tests construct `OAuthConfig` with loopback URLs; no production environment variable may redirect credentials.

Generate at least 32 random bytes with `getrandom`, encode state and verifier as unpadded base64url, and compute S256 with SHA-256.

- [ ] **Step 4: Write failing callback and token-exchange tests**

Use an Axum loopback server to assert:

- only `127.0.0.1` is bound;
- port 1455 falls back to 1457 in the deterministic fixture;
- exact path and state are required;
- fragments, duplicate state, missing code, and oversized query fail;
- response bodies contain only success/failure text and never state, code, verifier, or token;
- token exchange sends authorization-code form fields and returns credential material.

- [ ] **Step 5: Implement callback state and token exchange**

Bind before returning the authorization URL. Reject any host that is not loopback. Exchange with `application/x-www-form-urlencoded`; parse bounded JSON; wrap access/refresh tokens in `SecretMap`; require a positive bounded `expires_in`; and compute `expires_at` from Unix seconds.

On token endpoint errors, map known `access_denied` and `invalid_grant` codes to safe plugin error codes. Never include upstream response bodies in `Display`, `Debug`, or logs.

- [ ] **Step 6: Implement account extraction and refresh rotation**

Decode the access token as three base64url segments, parse only the payload, and read `https://api.openai.com/auth.chatgpt_account_id`. Require a non-empty header-safe value. Refresh preserves the old refresh token when the response omits one and rejects a new token whose account ID differs.

- [ ] **Step 7: Add the minimal sidecar entry point and dev wrapper**

`main.rs` initially handles only manifest, provider auth methods that return a safe `unsupported` code, and shutdown while preserving the NDJSON contract. `plugin.sh` execs the current debug binary for source-tree conformance:

```sh
#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
exec "$root/target/debug/codex-auth" "$@"
```

- [ ] **Step 8: Run plugin tests**

```sh
CARGO_BUILD_JOBS=4 cargo test -p codex-auth oauth -- --nocapture
CARGO_BUILD_JOBS=4 cargo test -p codex-auth callback -- --nocapture
```

Expected: PASS.

- [ ] **Step 9: Commit the OAuth core**

```sh
git add Cargo.toml Cargo.lock plugins/codex-auth
git commit -m "feat(codex-auth): add ChatGPT OAuth PKCE core"
```

---

### Task 11: Implement Codex model discovery and the provider sidecar

**Files:**
- Create: `/home/vstaln/gray/plugins/codex-auth/src/manifest.rs`
- Create: `/home/vstaln/gray/plugins/codex-auth/src/models.rs`
- Modify: `/home/vstaln/gray/plugins/codex-auth/src/main.rs`
- Modify: `/home/vstaln/gray/plugins/codex-auth/src/lib.rs`
- Modify: `/home/vstaln/gray/plugins/codex-auth/src/tests.rs`
- Modify: `/home/vstaln/gray/crates/gray/src/plugin_check.rs`

**Interfaces:**
- Consumes: Gray protocol 1.2 types, `ProviderRpc` payloads, and OAuth credential material.
- Produces: a complete `codex-auth` sidecar implementing all six provider RPCs.

- [ ] **Step 1: Write failing manifest tests**

Load `manifest::manifest()` and assert:

- name/version `codex-auth` / `0.1.0`, protocol `1.2`;
- capability exactly `provider.credentials`;
- provider ID `codex`;
- base URL `https://chatgpt.com/backend-api/codex`;
- explicit Responses request policy from the spec;
- bearer secret name `access_token`;
- metadata account, originator, OpenAI beta, and both session headers;
- operation set `login`, `refresh`, `revoke`, `models`.

- [ ] **Step 2: Run the manifest test and confirm failure**

```sh
CARGO_BUILD_JOBS=4 cargo test -p codex-auth manifest::tests -- --nocapture
```

Expected: FAIL because `manifest.rs` has not been added.

- [ ] **Step 3: Implement the exact provider declaration**

Construct the typed `ProviderDecl`; do not emit raw JSON independently. The host sets redirects off for every dynamic credential profile. Add source comments on adapted declarations and call `ProviderDecl::profile_binding("chatgpt-subscription")` in tests to prove the profile is host-validated.

- [ ] **Step 4: Write failing model parser/HTTP tests**

Use a loopback HTTP server and a fixture copied from the reference's model shape. Assert filtering to `visibility == "list"` and `supported_in_api == true`, unique IDs, context window, reasoning efforts, maximum 128 models, maximum 192 KiB HTTP body so the serialized result remains below Gray's 256 KiB frame, bearer/account/originator/accept headers, `client_version=<crate version>`, and no redirects.

- [ ] **Step 5: Implement bounded model discovery**

`provider/models` receives the current envelope, requires matching identity/binding, and calls the Codex models endpoint with redirect-disabled Reqwest. Return `ProviderModelCatalog`; map unsupported/auth/network/malformed/oversized states to safe machine codes without response bodies.

- [ ] **Step 6: Implement the six RPC handlers**

Maintain one `LoginOperation` per sidecar with a monotonically increasing generation. `start` binds the callback and returns a verification URI; `poll` reports pending/completed/failed/cancelled/lost; `cancel` aborts the callback; `refresh` uses the host envelope; `revoke` returns `unsupported` without a network call; `models` calls Task 11 Step 5.

Serialize one NDJSON frame per line to stdout. Use stderr only for a generic fatal diagnostic with no token-bearing text.

- [ ] **Step 7: Add dispatch tests**

Cover out-of-order request IDs, unknown provider/method, capability-independent manifest/shutdown, stale operation generation, cancel race, refresh rotation/account change, model failure, and shutdown while a callback is pending. Assert stdout contains protocol JSON only.

- [ ] **Step 8: Extend provider conformance checks**

In `/home/vstaln/gray/crates/gray/src/plugin_check.rs`, report provider count, auth-method count, valid profile bindings, and provider validation errors. Do not start browser login or require credentials in `gray plugin check`.

- [ ] **Step 9: Build and run the real sidecar fixture**

```sh
CARGO_BUILD_JOBS=4 cargo build -p codex-auth
./target/debug/gray plugin check /home/vstaln/gray/plugins/codex-auth
```

Expected: manifest/provider checks PASS and shutdown PASS.

- [ ] **Step 10: Run plugin and plugin-check tests**

```sh
CARGO_BUILD_JOBS=4 cargo test -p codex-auth
CARGO_BUILD_JOBS=4 cargo test -p gray plugin_check::tests
```

Expected: PASS.

- [ ] **Step 11: Commit the complete sidecar**

```sh
git add plugins/codex-auth crates/gray/src/plugin_check.rs
git commit -m "feat(codex-auth): implement provider sidecar"
```

---

### Task 12: Add end-to-end host/plugin fixtures and regression coverage

**Files:**
- Create: `/home/vstaln/gray/crates/gray/src/providers/contract_tests.rs`
- Modify: `/home/vstaln/gray/crates/gray/src/providers/mod.rs`
- Modify: `/home/vstaln/gray/crates/gray/src/providers/tests.rs`
- Modify: `/home/vstaln/gray/crates/gray/src/setup/provider_auth_tests.rs`
- Modify: `/home/vstaln/gray/crates/gray/src/setup/connect_draw_tests.rs`
- Modify: `/home/vstaln/gray/crates/gray/src/repl/mod.rs` only if a test seam is required; do not change production behavior to accommodate a test.

**Interfaces:**
- Consumes: every public host/provider interface from Tasks 1-11.
- Produces: one credential-flow integration test and one profile-driven inference test without real credentials.

- [ ] **Step 1: Add a host/plugin contract fixture**

Use the `provider_plugin.sh` protocol fixture to return a start URI, one pending poll, a completed fake credential, and a model catalog. Drive it through `SidecarProviderRpc`; do not duplicate NDJSON parsing in Gray tests.

- [ ] **Step 2: Test install-to-request without a real OAuth account**

The test must prove:

1. a cached installed provider resolves by namespaced ID;
2. `/connect` persistence stores only auth references;
3. `auth.json` contains the fake secrets with private permissions;
4. the broker refreshes once and persists rotation;
5. `OpenAiProvider` sends the Codex profile to a loopback Responses server;
6. model metadata reaches the picker/context cache;
7. logout deletes the entry even when fake revoke returns an error;
8. plugin absence leaves API-key setup unchanged.

- [ ] **Step 3: Add secret-leak assertions**

Capture logs and rendered status/error/debug output during start, poll, refresh, HTTP 401, model failure, logout, uninstall, and sidecar crash. Assert none contains `test-access`, `test-refresh`, account claim values, PKCE verifier, or authorization code.

- [ ] **Step 4: Add concurrent and terminal integration cases**

Run two requests through one dynamic source and assert one refresh. Inject transient failure with a still-valid token, terminal `invalid_grant`, account change, plugin exit, and redirect response. Assert the exact credential-preservation/deletion behavior from the spec.

- [ ] **Step 5: Run focused integration tests**

```sh
CARGO_BUILD_JOBS=4 cargo test -p gray providers::contract_tests -- --nocapture
CARGO_BUILD_JOBS=4 cargo test -p gray setup::provider_auth::tests -- --nocapture
CARGO_BUILD_JOBS=4 cargo test -p gray-provider codex_profile -- --nocapture
```

Expected: PASS.

- [ ] **Step 6: Commit the contract suite**

```sh
git add crates/gray/src/providers crates/gray/src/setup/provider_auth_tests.rs crates/gray/src/setup/connect_draw_tests.rs
git commit -m "test(provider): cover plugin auth contract end to end"
```

---

### Task 13: Document, license, package, and verify the release

**Files:**
- Modify: `/home/vstaln/gray/plugins/index.json`
- Modify: `/home/vstaln/gray/plugins/README.md`
- Create: `/home/vstaln/gray/plugins/codex-auth/LICENSE-APACHE`
- Create: `/home/vstaln/gray/plugins/codex-auth/THIRD_PARTY_NOTICE.md`
- Modify: `/home/vstaln/gray/docs/plugins.md`
- Modify: `/home/vstaln/gray/THIRD_PARTY_NOTICES.md`
- Modify: `/home/vstaln/gray/.github/workflows/plugins-release.yml`
- Modify: `/home/vstaln/gray/Cargo.lock` only if the final build changes resolution.

**Interfaces:**
- Consumes: the completed protocol, sidecar, and package-install behavior.
- Produces: an optional catalog entry, cross-platform release archive, Apache-2.0 compliance, operator docs, and a final verification report.

- [ ] **Step 1: Add the optional catalog entry**

```json
"codex-auth": {
  "ecosystem": "gray-native",
  "version": "0.1.0",
  "source": {
    "type": "tarball",
    "url": "https://github.com/vstaln/gray/releases/download/plugins-v0.1.0/gray-codex-auth-0.1.0.tar.gz"
  },
  "hash": "sha256:FILL_SHA256",
  "binary": "codex-auth/{target}/gray-codex-auth",
  "auto_grant_capabilities": ["provider.credentials"],
  "scope": "user",
  "description": "ChatGPT subscription authentication and Codex model access for Gray.",
  "homepage": "https://github.com/vstaln/gray/tree/main/plugins/codex-auth",
  "commands": []
}
```

Keep the existing deferred-digest release convention; the published official index must contain the archive's real SHA-256 before users install it.

- [ ] **Step 2: Package supported native targets**

Extend the plugin release workflow to build `gray-codex-auth` for the same supported target matrix as Gray, place binaries under normalized `{target}` directories, create one `gray-codex-auth-<version>.tar.gz`, and publish `SHA256SUMS-plugins`. Keep the existing three shell-plugin assets unchanged.

The workflow must run:

```sh
cargo test -p codex-auth
cargo fmt --check
cargo clippy -p codex-auth -- -D warnings
```

before packaging. Do not publish a tar if any target is missing or any manifest test fails.

- [ ] **Step 3: Copy license and attribution**

Copy the full Apache-2.0 text from `/home/vstaln/gray/reference/vercel-labs/fx/LICENSE` to `plugins/codex-auth/LICENSE-APACHE`. Add this exact repository-level record:

```text
vercel-labs/fx — Apache-2.0 — c95fcc66ada9bea4629f73199391c8a26438d760
ChatGPT OAuth PKCE, account-claim extraction, Codex request headers, and model-catalog behavior in plugins/codex-auth were adapted from this reference.
```

Add source headers to `oauth.rs`, `callback.rs`, and `models.rs` identifying the repository, license, and commit.

- [ ] **Step 4: Document install, consent, login, recovery, and removal**

Update `/home/vstaln/gray/docs/plugins.md` with:

- optional `gray plugin install codex-auth`;
- official-index auto-grant limited to `provider.credentials`;
- `/connect` → Codex → ChatGPT subscription;
- browser/headless URL behavior and five-minute timeout;
- local credential location and no-token-in-config guarantee;
- `/connect` removal, `gray plugin remove codex-auth`, transient refresh, terminal re-login, disabled plugin, and corrupt-store recovery;
- no `/codex-login`, no API-key fallback, and no real credentials in CI.

- [ ] **Step 5: Run package and documentation checks**

```sh
CARGO_BUILD_JOBS=4 cargo test -p gray-pkg index::tests
python3 -m json.tool plugins/index.json >/dev/null
rg -n 'vercel-labs/fx|c95fcc66ada9bea4629f73199391c8a26438d760|Apache-2.0' plugins/codex-auth docs/plugins.md THIRD_PARTY_NOTICES.md
```

Expected: JSON parses and every attribution file contains the repository, license, and pinned commit.

- [ ] **Step 6: Build the release sidecar and run conformance**

```sh
cargo build --release -p gray -p codex-auth
./target/release/gray plugin check /home/vstaln/gray/target/release/codex-auth
```

Expected: all manifest/provider/shutdown checks PASS.

- [ ] **Step 7: Run final repository verification once**

```sh
cargo fmt --check
cargo clippy --workspace -- -D warnings
cargo test --workspace
```

Expected: all commands exit 0. Re-read every changed file, inspect `git diff --check`, and verify no token-shaped values, local home paths, or loopback test endpoints were added to production config/docs.

- [ ] **Step 8: Run the dev binary smoke checks**

```sh
./target/debug/gray --help
./target/debug/gray plugin list
./target/debug/gray plugin check /home/vstaln/gray/plugins/codex-auth
```

Expected: help/list/check exit 0. Do not run a real ChatGPT login automatically.

- [ ] **Step 9: Perform the manual release login only with operator participation**

After the release package is published and its official index hash is replaced, the maintainer runs one browser login, chooses a Codex model, completes a normal tool turn, waits through one refresh, logs out, confirms `auth.json` deletion, and repeats once through `gray -p`. Record failures without copying tokens, codes, callback URLs, or account claims into the issue/log.

- [ ] **Step 10: Commit docs and release metadata**

```sh
git add plugins/index.json plugins/README.md plugins/codex-auth docs/plugins.md THIRD_PARTY_NOTICES.md .github/workflows/plugins-release.yml
git commit -m "docs(codex-auth): add licensing and release packaging"
```

- [ ] **Step 11: Report PR state before any push**

Run `gh pr list --state open`, `git status --short`, and `git diff main...HEAD --stat`. Report checks and what is unique versus `main`. Ask before pushing, tagging, publishing, merging, or closing anything. There is still one active branch and one PR; do not open another.
