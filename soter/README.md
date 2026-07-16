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
- contexts contains provider-neutral domain models owned by Context packs.
- capabilities contains provider-neutral integration capability contracts.
- providers contains typed implementation declarations, containment levels,
  logical host-transport allowlists, provider mappings, and explicit
  limitations.
- integrations contains provider-specific translators, pack-owned settings
  definitions, shareable field mappings, and contained runtimes; automations
  never import these modules directly.
- configurations contains explicit desired configurations, including portable
  capability sources, readiness modes, and selected pack consumers.
- hosts contains explicit adapter declarations and projection ownership.
- scenarios contains behavior-level fixtures and expected evidence.
- migrations maps prototype artifacts to their target ownership and state.
- kernel contains the target verifier shared by every future host projection.
- automations contains outcome-specific orchestration and completeness rules;
  it asks Core to resolve and persist state rather than owning provider transport
  or runtime storage.
- core contains provider-neutral resolution, preflight, evidence, offline and
  connected doctor operations, a shared execution service, and separate
  resumable capability-call, versioned sequential operation-plan, legacy
  single-call probe, explicit sequential provider-probe-plan, and
  approval-bound connected-transaction bridges. The
  CLI and local Soter MCP server are thin interfaces
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
doctor also consumes failed probe checkpoints through a typed, expiring summary
that identifies the exact lock, provider, semantic step, native route, and
failure category while excluding provider arguments, raw responses, credential
values, and error messages. This makes an unavailable or unauthenticated route
different from an unattempted probe without turning an old failure into current
health evidence. The connected
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
time and resuming by checkpoint plus call ID. Plan v1 retains fixed inputs;
plan v2 deterministically binds unique string-list references from earlier
normalized outputs, fingerprints the resolution, and skips empty relations
without a provider request. Meeting-intake Automation uses v2 for a bounded
policy index read, every policy page explicitly wired as an `applicable-policy`
portable source, the exact transcript, the CRM meeting matched by recording URI,
and only the organizations, projects, and tasks referenced through that meeting.
It requires exact policy URI/title agreement and every referenced related ID to
be returned before finalizing, then asks Core to persist a private snapshot and
pause the same run. Each policy entry records its configured subjects and
applicability reason; this does not claim the prose was interpreted or enforced.
Participant profiles remain unloaded. Core mechanically binds every snapshot
entry to exactly one normalized plan output and passed effect before persisting
it. The Notion provider returns deterministic versions for normalized records.
`context.crm` now owns a machine-readable portable record model. Kernel checks
that Automation writes and provider mappings use only its declared fields and
preserve scalar, list, content, mutability, relationship, and deduplication
semantics; Core enforces the same boundary on capability inputs and normalized
outputs. The mapping also scopes read, create, and update per record type rather
than making every mapped Notion database generically writable.
Its private readiness plan emits identity, exact schema and one-row bounded read
checks for every configured target, plus one exact read for every portable
document source marked `probe-read`, one visible host request at a time. The
typed provider mapping binds current property names and types—including the
observed `🫂 Contacts` organization relation—and schema drift fails closed. Only
minimized booleans, counts, and fingerprints enter the final probe; live row
values, policy bodies, and identity values do not. Exact target and document
references remain confined to the private checkpoint and lock scope. This plan
can establish exact-lock `crm.records.read` and `documents.content.read`
readiness, but not policy interpretation, write permission, write response
conformance, automation verification, or health. Otter's
identity-only probe still leaves transcript compatibility unknown. Notion
create and update translators now accept only explicitly mapped fields, but the
ordinary capability and operation-plan interfaces still block them. Core can
compile an exact connected operation-batch preview with deduplication or
expected-version preconditions, verification expectations, recovery modes, and
an expiring approval bound to both the change set and batch. The current
meeting-intake write set is Context-valid and mapped, so compilation isolates
the remaining blocker: the connector declares no automatic compensation route
for its summary create. No connected
create is executable yet. Mapped updates now run through a private durable
transaction checkpoint that consumes the exact approval, compares and retains
prior mapped values, verifies each effect, compensates verified earlier updates
in reverse after a later conflict, and surfaces ambiguous effects as
`needs-attention` without overstating rollback.
Meeting-intake Automation owns its proposal and post-write acceptance checks;
Core owns only the generic approval, dispatch, checkpoint, rollback, and
verifier-invocation mechanics. Before proposal, the Automation now creates a
grounded `automation-decision/v1` that covers the exact meeting and transcript
segments, every bounded task candidate, and every explicitly applicable policy
with exact citations. `ready` requires complete resolution; `needs-input`
records abstention and cannot become a change set. Core stores the connected
decision privately, binds it to the same paused run and context snapshot, and
rejects tampering or a competing decision. The contained and MCP selftests prove
that mechanism, including multiple-candidate disposition and a Codex-produced
decision, but not live judgment quality.
Host-started end-to-end dispatch is unproven, and
the checked-in connected doctor therefore reports `ready=unknown`; the separate
operation-batch compiler reports the concrete write blockers. This
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

Inspect the Notion probe plan without calling Notion:

    node soter/core/cli.mjs probe-prepare --lock soter/fixtures/meeting-intake/meeting-intake.lock.json --provider provider.integration.notion.mcp --json

It returns `currentCall`, beginning with `fetch({id: "self"})`. Execute exactly
that resolved native tool through the authenticated host route, then call
`probe-complete --checkpoint ID --call CALL_ID --response ABSOLUTE_PRIVATE_PATH`.
Each successful completion returns the next exact schema, bounded record-read,
or configured document-read call; the eighteenth closes a `provider-probe/v2`
with one fingerprint-bound check per step. A stopped, drifted, wrong-lock, or
incomplete plan contributes no probe.

After `npm install`, both host projections can start the same local
`soter-core` stdio server, bound to the launching host identity. Its prepare
tools durably checkpoint provider-neutral operations resolved through the
selected host adapter. The host may explain `currentCall.transport.operation`
when present (or the legacy `checkpoint.call.transport.operation`), but must
execute exactly the matching native tool through its separate authenticated MCP route
and return the native result to the matching complete tool. The server does
not call providers, persist raw responses, or originate or widen connected
write approval. Its stdio subprocess self-test establishes only the
shared Core recovery projection, not live host or provider conformance. The
self-test restarts the server with a call pending, rehydrates it, repairs planted
partial state, and rejects stale or tampered checkpoints.

The same service exposes `soter_prepare_operation_plan` and
`soter_complete_operation_plan`; the CLI equivalents are `plan-prepare` and
`plan-complete`. Plan v1 executes fixed portable inputs. Plan v2 additionally
binds a unique, sorted string list from an exact earlier normalized output path
into an unset later input path. Empty bindings explicitly skip or fail; they do
not become broad reads. Both versions allow one outstanding call and
stop-on-failure behavior. Every completion must include the exact checkpoint
and current call IDs. Normalized outputs and binding fingerprints stay in
private state while raw host responses do not. The interface supplies no write
approval: v1 represents a confirmation-gated step as blocked, while v2 rejects
the unavailable effect before beginning earlier work. Arbitrary transforms,
branching, fan-out, parallelism, plan-level retries, compensation,
approval-bound write execution, and rollback remain outside the general plan
contracts. Those responsibilities belong to the separate connected transaction
checkpoint.

The connected update workflow is:

    node soter/core/cli.mjs connected-batch-preview --lock LOCK --change-set CHANGE_SET --batch-id BATCH_ID --json > /private/batch.json
    node soter/core/cli.mjs connected-batch-approve --batch /private/batch.json --change-set CHANGE_SET --approval-id APPROVAL_ID --actor ACTOR --reason REASON --expires-at TIME --at TIME --json > /private/approval.json
    node soter/core/cli.mjs connected-transaction-prepare --lock LOCK --run RUN --batch /private/batch.json --change-set CHANGE_SET --approval /private/approval.json

Preparation writes private state under `.soter/state` and returns one exact
compare call. Execute only its resolved native host tool, then advance with
`connected-transaction-complete --checkpoint ID --call CALL_ID --response
ABSOLUTE_PRIVATE_PATH`; each completion returns at most the next write, verify,
compare, or compensation call. The MCP equivalent is
`soter_advance_connected_transaction`, which accepts only an existing
checkpoint ID, exact call ID, and native response—never an approval document.
The first write must start before the approval expires (at most fifteen minutes
after creation). Verification and compensation may continue afterward.

For a `needs-attention` checkpoint, prepare one read-only observation with:

    node soter/core/cli.mjs connected-transaction-reconcile --checkpoint ID

Execute the returned exact read and pass its response to
`connected-transaction-complete`; MCP uses
`soter_reconcile_connected_transaction` followed by
`soter_advance_connected_transaction`. Reconciliation never accepts approval or
retries a write. Approved fields resume an ambiguous update, prior fields close
that update and recover earlier verified effects, and only prior fields prove
ambiguous compensation. Missing, divergent, or failed reads remain paused and
can be observed again later through another bounded attempt.

This is an external saga, not an ACID transaction. `completed` means every
approved update was read back. `rolled-back` means verified earlier updates were
restored after a later deterministic failure. `failed` means no ambiguous write
remains. `needs-attention` means Core cannot prove whether an external effect or
its compensation occurred. It will not guess or retry it automatically; its
reconciliation history records exact minimized observations instead. Mapped
creates remain blocked until their selected provider has a governed automatic
compensation route. Local self-tests use synthetic host results and do not prove
connected credentials, write permission, response conformance, or live health.

Meeting intake also exposes `soter_prepare_meeting_intake_context` and
`soter_finalize_meeting_intake_context`; the CLI equivalents are
`context-connected-prepare` and `context-connected-finalize`. The prepare tool
derives providers and authorities from the exact lock and returns the first
ordinary plan call. After generic plan completion closes the policy index, every
configured exact policy-page read, the transcript and meeting reads, and any
nonempty organization, project, and task chain, finalization requires every
policy URI/title pair and body fingerprint to match, a non-empty
speaker-consistent transcript, exactly one CRM meeting with the same normalized
recording URI, and every and only requested related record ID. It stores the
private snapshot under `.soter/state/context-snapshots`, marks the definition
authority loaded, updates the durable run, and pauses before writes. Participant
People IDs remain references, not assumed CRM contact page URIs.

After finalization, `soter_commit_meeting_intake_decision` accepts only bounded
candidate identities, transcript segment indexes, exact policy quotes,
dispositions, reasons, issues, and limitations. Core derives and validates all
record, entry, segment, quote, snapshot, lock, graph, run, and host fingerprints
before writing `.soter/state/automation-decisions`. Use `needs-input` when any
candidate or policy remains unresolved. `soter_propose_meeting_intake_change_set`
projects only a `ready` decision and creates neither approval nor provider call.
After compaction, `soter_inspect_meeting_intake_decision` recovers the exact
normalized private snapshot plus a safe template that already enumerates every
candidate as unresolved. The CLI equivalents are:

    node soter/core/cli.mjs meeting-intake-decision-inspect --lock LOCK --snapshot SNAPSHOT_ID --json > /private/decision-workspace.json
    node soter/core/cli.mjs meeting-intake-decision-commit --lock LOCK --snapshot SNAPSHOT_ID --decision-input ABSOLUTE_PRIVATE_PATH --decision-id DECISION_ID --actor ACTOR
    node soter/core/cli.mjs meeting-intake-proposal --lock LOCK --decision DECISION_ID --change-set-id CHANGE_SET_ID --json > /private/change-set.json

The generated change-set scope includes the exact decision and context-snapshot
basis. Any changed judgment, citation, candidate disposition, or grounding
therefore requires a new proposal and later approval.

Private run, call, context-snapshot, and Automation-decision state lives under `.soter/state`, uses
atomic restricted files, and is ignored by Git. `soter_list_host_calls` and
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
