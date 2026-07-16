# Soter Harness

Soter is a user-owned harness for building durable context, repeatable
automations, and safe integrations around capable agent hosts.

Its goal is simple: a user should be able to choose the systems they want,
understand why each one is present, run the same intended behavior through
Codex, Claude, or another compatible host, and improve the harness without
turning it into an untraceable collection of prompts and scripts.

Soter is both:

- a provider-neutral architecture for defining, connecting, checking, and
  evolving harness systems; and
- a reference implementation that proves those contracts on real hosts and
  integrations.

It is not a model, a replacement for an agent host, or unrestricted
self-modifying software.

## The model

Soter has five architectural layers. They classify responsibility; they are not
five sequential runtime stages.

| Layer | Responsibility | Why it exists |
|---|---|---|
| **Kernel** | Defines how harness artifacts are authored, validated, evaluated, approved, versioned, and packaged. | Makes the harness mechanically trustworthy and able to evolve coherently. |
| **Core** | Resolves configuration, assembles runtime context, binds capabilities, applies effect policy, records evidence, and reports health. | Gives every selected system the same portable runtime substrate. |
| **Context** | Defines domain concepts, schemas, relationships, policies, and authorities. | Gives work stable meaning without confusing domain knowledge with a model's temporary context window. |
| **Automation** | Declares outcomes, triggers, orchestration, and required capabilities. | Describes what work should happen without coupling it to a particular vendor or tool. |
| **Integration** | Implements capabilities through local resources or external providers. | Lets automations run consistently while providers can be selected or replaced independently. |

Codex, Claude, and future agent runtimes are **hosts**, not layers. A host
adapter projects the same resolved Soter configuration into the host's native
instructions, skills, tools, hooks, and lifecycle.

## How the pieces connect

A normal run follows one shared contract:

1. A request, event, or schedule selects a run intent and automation.
2. Core resolves the user's selected packs, versions, dependencies, policies,
   and authority sources.
3. Core assembles only the relevant context and records exactly what was used.
4. The automation requests typed capabilities instead of calling a provider
   directly.
5. Integration bindings translate those capabilities into provider operations.
   When MCP is selected, Core emits a typed host-tool request; the active host
   executes its authenticated MCP tool and returns the result for normalization.
6. Authentication, permission, effect, freshness, and health rules apply at
   that boundary without exposing host-qualified tool names to the automation.
7. Soter verifies the outcome and records evidence.
8. Evidence may produce an improvement candidate for a separate, appropriately
   gated development run.

The persisted run envelope keeps the resolved configuration, authorities,
bindings, host, effects, and evidence recoverable after context compaction or a
resumed session. A green check should therefore mean more than “the files look
valid”; it should identify what behavior was proven, against which exact
configuration.

## Systems, packs, bundles, and configuration

A **system** is a coherent capability with an explicit promise and contract. A
**pack** is that system's selectable and distributable unit. The terms refer to
the same boundary from architectural and packaging perspectives.

An **artifact** is an internal part of a pack, such as a schema, guide, rule,
template, evaluator, or adapter. Users select packs, not loose artifacts.

A **bundle** is a named, versioned recommendation of compatible packs. It is a
convenient starting point, not a hidden configuration tier: users can inspect
it, remove any optional pack, add another, and share the resulting
configuration.

Every installed configuration should make these answers visible:

- Which packs are selected, and why?
- Which versions and transitive dependencies were resolved?
- Which sources are authoritative for definitions and live instances?
- Which automation capability is bound to which integration?
- Which effects are permitted, gated, or prohibited?
- Which host projection is active?
- What is valid, ready, verified, and healthy right now?

The kernel and a minimum core are required. Additional core capabilities plus
context, automation, and integration packs are user-selectable. Canonical
sources may live inside the harness or in external systems; the contract records
their authority role instead of assuming location determines truth.

## One runtime, four intents

Soter does not need separate runtimes for “using” and “building” itself. One
runtime operates under four explicit intents:

- **Inspect** reads definitions, configuration, evidence, and health without
  changing them.
- **Operate** performs selected work under the resolved configuration and
  effect policy.
- **Configure** changes pack selection, bindings, authorities, or permissions
  through a previewed configuration transaction.
- **Develop** changes harness definitions or implementations through kernel
  authoring and verification contracts.

Intent changes are explicit. An operational run may detect a weakness and
propose development work, but it does not silently rewrite the behavior it is
using for that run.

## Learning without drift

Soter's learning loop is:

observed evidence → diagnosed gap → candidate change → evaluation → scoped
promotion → monitoring

The working prototype relies heavily on human approval. That is a deliberately
conservative starting point, not the end state. Gates should become more
autonomous only where repeated evidence supports a narrow, reversible policy.
Autonomy remains specific to the kind of change and effect, can be revoked, and
never turns absence of review into proof of quality.

Learning occurs at three scopes:

- run adaptation, which changes only the current run;
- user learning, which changes private preferences or configuration; and
- shared pack evolution, which creates a versioned change other users may
  choose to adopt.

## Current state

This repository is a useful, mostly working prototype built around Claude Code.
It already contains strong ideas for templates, vocabulary, standards,
evaluation, enforcement, authoring, and several domain workflows. It is not yet
the finished architecture described above.

The main remaining gaps are structural and behavioral:

- Core now proves deterministic resolution, artifact-fingerprinted locks,
  effect-free preflight, typed fixture capability dispatch, authority-aware
  context assembly, exact-scope approvals, transactional fixture writes,
  rollback, read-after-write verification, scoped evidence, and offline
  diagnosis, and the policy-bound request/result state machine for resumable
  host-dispatched MCP calls. A shared Core service now projects that resumable
  handshake through both the CLI and a local stdio MCP server configured for
  Codex and Claude. The first connected Otter declaration now emits an
  exact `fetch({id})` request and an identity-only `get_user_info({})` probe
  request through separate resumable contracts. The connected Notion read
  declaration now translates bounded portable CRM record requests through a
  pack-owned field mapping and user-configured target identities. Each call is
  limited to one target so cross-data-source SQL never becomes a hidden Notion
  plan requirement. Its
  identity-only probe can establish authentication and reachability while
  leaving target authority and schema compatibility unknown. Connected Notion
  writes remain intentionally undeclared until multi-call deduplication,
  compare-before-write, exact approval binding, and read-after-write
  verification exist. Observed provider response-shape conformance, actual
  dispatch through either host, and host-level agent behavior remain unproven.
- Legacy provider behavior remains mixed into automations. The target now
  separates fixture reads and writes behind typed capabilities, but connected
  implementations and legacy migration remain.
- The target has an explicit desired configuration and lock, but host
  realization and install/upgrade transactions are not implemented.
- Evidence does not yet support complete transitive freshness and health claims.
- Claude-specific realization is more mature than Codex or other host adapters.

The target host projections are now explicitly MCP-aware. Both hosts register
the same local Soter Core server; Claude retains its existing Notion plugin and
Otter project MCP configuration, while Codex declares the Notion app connector
and registers Otter's official remote MCP server in `.codex/config.toml`. MCP
is the authenticated host transport; Soter capability contracts remain the
stable automation interface.

We are evolving the existing codebase rather than assuming its current shape is
the target. Migration will proceed in small vertical slices, with compatibility
bridges where they reduce risk. Existing working behavior is evidence and input,
not a constraint against a better design.

The provider-neutral target foundation lives under [soter/](./soter/). Its
initial manifests declare the meeting-intake slice, capability contracts,
desired configuration, behavior scenarios, and migration mapping. Minimum Core
fixtures prove exact lock resolution, preflight, schema-valid CRM/transcript
context assembly, confirmation-gated writes, rollback mechanics, and
read-after-write verification through local providers. A negative connected
doctor fixture also proves that missing connected Notion write implementations
and missing current provider probes fail or leave readiness unknown without
being represented as graph or fixture failures. All packs remain at an
**experimental** release stage and **declared** evidence maturity because those
claims do not prove connected or agent-host behavior. The graph and checked-in
lock are valid; connected readiness, full automation verification, and live
health remain unknown until their applicable checks run.

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) defines Soter's intent, boundaries,
  conceptual model, operating architecture, and migration direction.
- [CONTRACTS.md](./CONTRACTS.md) defines the mechanical contracts for systems,
  resolution, runtime, learning, configuration, distribution, hosts,
  integrations, verification, and health.
- [.claude/](./.claude/) contains the current Claude-oriented implementation and
  its checker, systems, templates, guides, evaluations, and rules.
- [soter/](./soter/) contains the provider-neutral target contracts, pack graph,
  configurations, scenarios, migration manifests, and verifier.

The architecture and contracts are the target source of truth. Generated host
files, CLI reports, and future graphical views should all consume the same
structured model so they cannot quietly drift from one another.

## Working with the current prototype

Run the current deterministic checker:

    node .claude/scripts/check.mjs --all

Verify the target contract graph and inspect its honest health state:

    node soter/kernel/verify.mjs
    node soter/kernel/verify.mjs --json

Exercise Core resolution and its checked-in preflight evidence:

    node soter/core/cli.mjs selftest
    node soter/core/cli.mjs fixtures --check
    node soter/core/cli.mjs doctor --lock soter/fixtures/meeting-intake/meeting-intake.lock.json

Run the same contained context operation through the shared CLI:

    node soter/core/cli.mjs context \
      --lock soter/fixtures/meeting-intake/meeting-intake.lock.json \
      --scenario soter/scenarios/meeting-intake/happy-path.scenario.json \
      --meeting-id meeting.fixture-001 \
      --recording-uri otter://fixture/meeting.fixture-001

Preview and explicitly approve the contained write transaction:

    node soter/core/cli.mjs transaction \
      --lock soter/fixtures/meeting-intake/meeting-intake.lock.json \
      --scenario soter/scenarios/meeting-intake/happy-path.scenario.json

    node soter/core/cli.mjs transaction \
      --lock soter/fixtures/meeting-intake/meeting-intake.lock.json \
      --scenario soter/scenarios/meeting-intake/happy-path.scenario.json \
      --approve

The offline doctor intentionally reports `ready=unknown`, `verified=unknown`,
and `healthy=unknown`. It checks local graph and lock integrity; it does not
touch credentials or providers.

Inspect connected readiness separately:

    node soter/core/cli.mjs doctor \
      --lock soter/fixtures/meeting-intake/meeting-intake.lock.json \
      --level connected

The connected Notion declaration covers reads only, while the
meeting-intake automation also requires create and update capabilities. With
those connected writes intentionally absent and no current private Notion or
Otter probe, that command exits nonzero with `ready=failed`. A connected
integration must emit a `provider-probe/v1` document for the exact lock; Core
will reject
missing, expired, malformed, ambiguous, or wrong-lock probes. Probe documents
contain secret-reference identifiers and safe observations, never secret
values. Connected readiness does not by itself establish automation
verification or end-to-end health.

Core also exposes the host-neutral probe handshake for adapters and debugging:

    node soter/core/cli.mjs probe-prepare \
      --lock soter/fixtures/meeting-intake/meeting-intake.lock.json \
      --provider provider.integration.otter.mcp \
      --json

Core atomically stores the exact request under `.soter/state/host-calls` before
returning it. The host executes only `checkpoint.call.transport` with
`checkpoint.call.arguments`, then resumes by checkpoint ID:

    node soter/core/cli.mjs probe-complete \
      --checkpoint checkpoint.probecall.example \
      --response /private/transient/otter-response.json

The response file must use an absolute private path outside the repository; the
CLI rejects relative paths, repository paths, and symlinks that resolve into the
repository. Delete the transient input after completion. Core never copies its
native body into durable state; it stores the typed probe plus response
fingerprint. The current Otter producer intentionally
reports `meeting.transcript.read=unknown` because `get_user_info` does not read a
transcript.

A connected doctor can consume the completed private checkpoint directly:

    node soter/core/cli.mjs doctor \
      --lock soter/fixtures/meeting-intake/meeting-intake.lock.json \
      --level connected \
      --probe-checkpoint checkpoint.probecall.example

Core revalidates the checkpoint against the current exact lock before using its
normalized probe; no export or raw response file becomes evidence by accident.

Install the pinned local MCP runtime and verify the stdio protocol path:

    npm install
    npm run soter:mcp:selftest

Codex and Claude both load `soter/core/mcp/server.mjs` as a local stdio MCP
server bound to that host's identity. A host cannot consume a lock resolved for
another host. Its tools follow one explicit sequence:

1. Call `soter_prepare_provider_probe` or
   `soter_prepare_capability_call`.
2. Continue only when `checkpoint.call.state` is `requested`.
3. Inspect `checkpoint.call.transport.operation` for the provider-neutral
   operation, then invoke exactly the host-native
   `checkpoint.call.transport.tool` with `checkpoint.call.arguments` through
   `checkpoint.call.transport.server` and its separately authenticated route.
4. Pass the native response unchanged with `checkpoint.id` to the matching
   completion tool, or close it with `soter_fail_host_call`.
5. After restart or compaction, use `soter_list_host_calls` and
   `soter_get_host_call` instead of reconstructing the request from memory.

The local server never calls Otter, Notion, or another provider itself. Its MCP
self-test launches the stdio server and supplies synthetic provider results,
terminates it with a request pending, reconnects, rehydrates the checkpoint,
and completes the durable run. It also rejects wrong-host, stale, conflicting,
and tampered state and verifies that the native provider body did not reach
disk. This proves the local Core recovery boundary, not that Codex or Claude
started the server, authenticated a provider, selected the right provider tool,
or completed a real external run. The equivalent CLI commands are
`capability-prepare`, `capability-complete`, `host-list`, `host-get`, and
`host-fail`.

`.soter/state` is private user runtime state and is ignored by Git. It may
contain portable inputs and normalized provider outputs needed to resume work;
do not copy it into packs, fixtures, commits, or shared configurations.

For Codex, trust the project and authenticate the declared Otter server once:

    codex mcp login otter

The same authentication can be initiated from Codex desktop MCP settings.
Restart the task after the connection is added so the host can expose the new
tools. Notion authentication remains owned by the separately installed Codex
app connector; no provider credentials belong in this repository. See the
[Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp) and
[Otter MCP setup](https://help.otter.ai/hc/en-us/articles/35287607569687-Otter-MCP-Server)
for the host and provider setup contracts.

Useful discovery commands:

    find .claude/systems -maxdepth 1 -name '*.md' -print
    find .claude/skills -name SKILL.md -print
    find soter/packs -name pack.json -print

Do not treat those current folders as the permanent public architecture. During
migration, each existing artifact will be explicitly mapped, bridged, migrated,
or retired, with its replacement and verification evidence recorded.

## Near-term build order

The contract foundation, meeting-intake graph, and contained Core transaction
path now exist. They define and enforce structure without claiming the target
runtime is connected or ready.

1. Define machine-readable pack, dependency, capability, authority, effect, and
   configuration contracts.
2. Declare meeting intake as the representative vertical slice with its
   outcomes, scenarios, capability needs, authorities, effects, and migration
   mapping.
3. Finish the connected integration slice: add an exact-lock Notion target
   schema/read probe, use the connected read capability in context assembly,
   validate Otter transcript response normalization with an explicitly
   authorized private meeting fixture, and prove actual Codex and Claude
   dispatch and checkpoint recovery through the configured Core service. Then
   model multi-call operation batches and add approval-bound connected Notion
   writes plus the separately authorized canary doctor level.
4. Prove the full judgment and orchestration slice through both Claude and
   Codex host adapters rather than treating deterministic fixture mechanics as
   agent behavior evidence.
5. Expand configuration, bundles, sharing, progressive autonomy, and UI only on
   top of the proven contracts.

The detailed sequencing and completion gates live in
[ARCHITECTURE.md](./ARCHITECTURE.md). The next implementation step should prove a
thin end-to-end path, not recreate every current artifact in a new folder
layout.
