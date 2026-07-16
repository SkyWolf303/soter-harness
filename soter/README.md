# Target implementation

This directory is the provider-neutral implementation of the architecture in
[ARCHITECTURE.md](../ARCHITECTURE.md) and [CONTRACTS.md](../CONTRACTS.md).

The existing .claude directory remains the working prototype and compatibility
bridge while behavior is migrated in vertical slices. Files here must not claim
that mapped behavior has been migrated or proven. Maturity and verification
fields make that distinction mechanical.

## Layout

- contracts contains versioned machine-readable contracts.
- packs contains one manifest for each selectable system.
- capabilities contains provider-neutral integration capability contracts.
- providers contains typed implementation declarations, containment levels,
  logical host-transport allowlists, provider mappings, and explicit
  limitations.
- integrations contains provider-specific translators, pack-owned settings
  definitions, shareable field mappings, and contained runtimes; automations
  never import these modules directly.
- configurations contains explicit desired configurations.
- hosts contains explicit adapter declarations and projection ownership.
- scenarios contains behavior-level fixtures and expected evidence.
- migrations maps prototype artifacts to their target ownership and state.
- kernel contains the target verifier shared by every future host projection.
- core contains provider-neutral resolution, preflight, evidence, offline and
  connected doctor operations, a shared execution service, and separate
  resumable capability-call, fixed-input sequential operation-plan, and
  provider-probe bridges. The CLI and local Soter MCP server are thin interfaces
  over that service; future graphical interfaces must consume the same boundary.
- fixtures contains generated, cross-linked examples of exact locks, run
  envelopes, evidence, and doctor results. These are runtime-state examples,
  not pack source artifacts.

## First vertical slice

Meeting intake is the first declared slice because it crosses all important
runtime seams:

1. CRM context supplies meeting meaning and authority.
2. The meeting-intake automation declares the outcome and required
   capabilities.
3. Otter and Notion integration packs fulfill those capabilities.
4. Effect policy allows reads but requires confirmation before external writes.
5. Scenarios preserve grounding, staleness, deduplication, and gate invariants.

This increment declares the slice and implements its contained Core path:
deterministic resolution, an artifact-fingerprinted lock, effect-free preflight,
typed local Notion/Otter fixture providers, authority-aware context assembly,
exact-scope approvals, transactional in-memory writes, rollback proof,
read-after-write verification, scoped evidence, and an offline doctor report.
It also validates and aggregates short-lived provider probes into an honest
connected-readiness result and proves the state machine for policy-bound MCP
dispatch with synthetic host results. A local stdio MCP projection exposes that
same Core service to both Codex and Claude without becoming a provider proxy or
accepting generic connected-write approvals. It atomically checkpoints each
call and its private run state before returning a provider request, and can
rehydrate pending work by checkpoint ID after a server restart. The connected
Otter provider now
translates a canonical meeting URL into exact `fetch({id})` arguments and
produces an identity-only `get_user_info({})` probe. That probe can pass
authentication and reachability while leaving transcript compatibility
unknown. Unobserved transcript response shapes fail closed. The connected
Notion provider now implements bounded CRM record reads using a pack-owned
settings schema, a provider-owned field mapping, and exact native tool mappings
for each host adapter. A connected read is limited to one record type and data
source per host call, avoiding a hidden dependency on plan-gated
cross-data-source SQL. Core can now orchestrate several such reads through one
private sequential operation-plan checkpoint, emitting one exact call at a
time and resuming by checkpoint plus call ID. Context assembly does not consume
that plan yet. It returns deterministic versions for normalized records. Its
identity probe proves only authentication and reachability;
configured target access and schema/read compatibility remain unknown. Notion
create and update implementations are intentionally absent until Soter adds
typed output binding, multi-call deduplication, compare-before-write, exact
change-set approval, read-after-write verification, and compensation.
Host-started end-to-end dispatch is unproven, and
the checked-in connected doctor therefore still reports `ready=failed`. This
increment does not fetch a user's meeting, prove provider transcript or Notion
target conformance, prove host-level agent judgment, or replace the existing
processing-a-meeting guide.

## Verify

Run the target verifier:

    node soter/kernel/verify.mjs

Its JSON form exposes the same resolved selections, reasons, dependencies,
bindings, authorities, effects, host declaration, and health states that future
CLI and graphical views should consume:

    node soter/kernel/verify.mjs --json

Prove the verifier catches planted failures:

    node soter/kernel/verify.mjs --selftest

Prove Core output contracts, stale-lock detection, and honest offline states:

    node soter/core/cli.mjs selftest
    npm run soter:mcp:selftest
    node soter/core/cli.mjs fixtures --check
    node soter/core/cli.mjs doctor --lock soter/fixtures/meeting-intake/meeting-intake.lock.json

Inspect the expected missing-write-implementation and missing-probe diagnostics:

    node soter/core/cli.mjs doctor --lock soter/fixtures/meeting-intake/meeting-intake.lock.json --level connected

This exits nonzero by design. Otter and Notion have connected read
declarations, but no private probes are checked in and Notion create/update are
not declared. Connected adapters pass one or more exact-lock `--probe PATH`
artifacts; Core never accepts a fixture result as connected state.

Inspect the structured Otter probe request without calling the provider:

    node soter/core/cli.mjs probe-prepare --lock soter/fixtures/meeting-intake/meeting-intake.lock.json --provider provider.integration.otter.mcp --json

The emitted request is `otter/get_user_info` with empty arguments. Core stores
it as private runtime state before returning it. A host can resume through
`probe-complete --checkpoint ID --response ABSOLUTE_PRIVATE_PATH`; the CLI
requires the file's real path to remain outside the repository, and the caller
deletes it after completion. The response is transient input, not durable
state. Core persists only fingerprints and the
normalized probe, and the probe leaves
`meeting.transcript.read` unknown until a specifically authorized transcript
response proves the adapter shape.

Connected doctor accepts a completed durable probe through
`--probe-checkpoint ID` and revalidates it against the current exact lock. A
stale or incomplete checkpoint cannot contribute readiness observations.

After `npm install`, both host projections can start the same local
`soter-core` stdio server, bound to the launching host identity. Its prepare
tools durably checkpoint provider-neutral operations resolved through the
selected host adapter. The host may explain
`checkpoint.call.transport.operation`, but must execute exactly the native
`checkpoint.call.transport.tool` through its separate authenticated MCP route
and return the native result to the matching complete tool. The server does
not call providers, persist raw responses, or authorize
confirmation-gated writes. Its stdio subprocess self-test establishes only the
shared Core recovery projection, not live host or provider conformance. The
self-test restarts the server with a call pending, rehydrates it, repairs planted
partial state, and rejects stale or tampered checkpoints.

The same service exposes `soter_prepare_operation_plan` and
`soter_complete_operation_plan`; the CLI equivalents are `plan-prepare` and
`plan-complete`. The initial plan contract executes fixed portable inputs in
order with one outstanding call and stop-on-failure behavior. Every completion
must include the exact checkpoint and current call IDs. Normalized outputs stay
in private state while raw host responses do not. The interface supplies no
write approval, so confirmation-gated steps block without arguments. Output
bindings, branching, parallelism, plan-level retries, compensation,
approval-bound write batches, and rollback remain future contracts.

Private run and call state lives under `.soter/state`, uses atomic restricted
files, and is ignored by Git. `soter_list_host_calls` and
`soter_get_host_call` are the recovery interface after compaction or restart.
This state may contain portable inputs and normalized outputs; it must not be
distributed as pack content, fixtures, configuration, or evidence.

The Codex projection registers Otter in `.codex/config.toml`. After trusting
the project, authenticate once with `codex mcp login otter` or through Codex
desktop MCP settings, then restart the task so the server tools are loaded.
Notion is supplied by the external Codex app connector. Neither route stores
OAuth credentials in the repository.

Generate a proposed lock without provider access:

    node soter/core/cli.mjs resolve --config soter/configurations/meeting-intake.config.json --json

Exercise typed context assembly without external access:

    node soter/core/cli.mjs context --lock soter/fixtures/meeting-intake/meeting-intake.lock.json --scenario soter/scenarios/meeting-intake/happy-path.scenario.json --meeting-id meeting.fixture-001 --recording-uri otter://fixture/meeting.fixture-001

Preview or approve the contained transaction:

    node soter/core/cli.mjs transaction --lock soter/fixtures/meeting-intake/meeting-intake.lock.json --scenario soter/scenarios/meeting-intake/happy-path.scenario.json
    node soter/core/cli.mjs transaction --lock soter/fixtures/meeting-intake/meeting-intake.lock.json --scenario soter/scenarios/meeting-intake/happy-path.scenario.json --approve

`fixtures --update` is an explicit regeneration operation. Review its diff;
never update fixtures merely to silence a stale-lock failure.

During migration, both the legacy checker and the target verifier must pass.
The legacy checker protects behavior that has not moved; the target verifier
protects the new contracts and resolved graph. The migration ends this overlap
by retiring the legacy entrypoint after all owned behavior has moved.
