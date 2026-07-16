# Soter contracts

This document defines the normative contracts that implement the architecture
described in [ARCHITECTURE.md](./ARCHITECTURE.md). The architecture owns purpose,
layer meaning, and migration direction; this document owns the detailed
mechanics that Soter must validate and preserve across implementations.

## Contracts and connections

Soter is a connected system, not a collection of instruction files. Every
installed system must explain what it is for, what it requires, what it makes
available, how it can affect the world, and how anyone can verify that it
works. These declarations form a graph that the kernel can inspect before an
agent or automation relies on it.

### Layer connection rules

The five-layer order does not allow arbitrary coupling. Kernel and core cannot
depend on a particular domain, automation, provider, or agent host. Context
cannot depend on an automation or provider implementation. An automation may
consume context and request integration capabilities, but it cannot require a
particular vendor when a portable capability can express the need. An
integration implements capability contracts; it does not contain
automation-specific business logic.

For example, an automation may require `records.create` for a configured CRM
authority. A Notion integration and a Salesforce integration may both fulfill
that capability. The user's configuration chooses the binding without changing
the automation's intended outcome.

### System contract

Every pack must declare enough information for a human and the kernel to answer:

- **Identity:** What is its stable identifier, version, layer, and status?
- **Purpose:** Why does it exist, what outcome does it promise, and what is
  explicitly outside its scope?
- **Requirements:** Which packs, context contracts, authorities, and
  capabilities does it require? Which are optional?
- **Interface:** What contracts, capabilities, artifacts, or evidence does it
  make available to other systems?
- **Authority:** Where does each source of truth live, why is it authoritative,
  how is freshness established, and what is the fallback when it is
  unavailable?
- **Effects:** What can it read or change, how reversible are those changes,
  and which approval or autonomy policy applies?
- **Configuration:** Which choices may the user make, what do the defaults mean,
  and why might a different choice be appropriate?
- **Verification:** Which static checks, contract tests, scenario evaluations,
  and live checks demonstrate that it works?
- **Compatibility:** Which contract versions, hosts, and integration
  capabilities does it support?
- **Maturity:** What evidence supports its current level of trust, and what is
  required before it can act more autonomously?

These fields may be stored in a manifest, artifact frontmatter, or another
structured form. Their meaning is canonical; a README, CLI, UI, or agent-facing
instruction is a projection of the same data rather than a separately
maintained description.

### Resolution rules

Before a configured harness is ready to run, the kernel and core must resolve
its complete graph:

- Every required pack and contract reference resolves to one compatible
  version.
- Every required integration capability has exactly one selected binding unless
  the contract explicitly allows several.
- Every required authority is configured and its access policy is known.
- Every effect has an applicable approval or autonomy policy.
- Optional requirements are explicitly marked and report which behavior is
  unavailable when absent.
- Cycles, incompatible versions, ambiguous bindings, and forbidden layer
  dependencies are reported with a path to the source of the conflict.

An unresolved required connection fails closed. An unresolved optional
connection produces a visible degraded state; it never silently changes the
meaning of an automation.

Users must be able to add or remove any selectable context, automation, or
integration pack. Before applying a change, Soter shows what the pack enables,
why it is recommended, which systems depend on it, and what will stop working
if it is removed. Kernel and core packs are the required base and are presented
as such rather than hidden as defaults.

### Assembly health

Soter reports separate health states so “working” is not an ambiguous claim:

- **Valid:** declarations are well-formed and the contract graph is internally
  consistent.
- **Ready:** required packs, authorities, capabilities, permissions, and effect
  policies are resolved for this configuration.
- **Verified:** the applicable checks and evaluations pass on the selected host
  and integrations.
- **Healthy:** recent runtime evidence shows the configured systems completing
  their promised outcomes within policy.

A system can therefore be valid but not ready, or verified but not recently
healthy. CLI commands, graphical interfaces, and agents must read these states
and their evidence from the same structured source.

## Runtime and learning

Soter runs a declared automation against a resolved configuration. The runtime
must preserve enough state to explain the result, resume safely, distinguish a
real improvement from a one-off outcome, and detect when previous evidence is
no longer applicable.

```mermaid
flowchart LR
    A[Request or trigger] --> B[Resolve configuration and graph]
    B --> C[Assemble run envelope]
    C --> D[Evaluate effects and policy]
    D --> E[Execute through capabilities]
    E --> F[Verify promised outcome]
    F --> G[Record evidence]
    G --> H[Evaluate improvement candidates]
```

### Run lifecycle

Every interactive, scheduled, or event-driven run follows the same lifecycle:

1. **Identify the request.** Record the user's requested outcome or triggering
   event, select the run intent, and select the automation meant to handle it.
2. **Resolve the configuration.** Verify the selected pack graph, capability
   bindings, authorities, permissions, compatibility, and health requirements.
3. **Assemble context.** Retrieve the minimum sufficient context required by
   the automation's contracts and record its authority, provenance, freshness,
   and relevant version or fingerprint.
4. **Establish effects.** Determine the possible reads, disclosures, local
   changes, external changes, and dispatches before performing them. Resolve
   the applicable approval or autonomy policy.
5. **Execute the automation.** Use core services and integration capabilities,
   checkpointing where a retry or continuation may be needed.
6. **Verify the outcome.** Test the automation's promised outputs and external
   effects rather than treating an agent's completion message as proof.
7. **Record evidence.** Persist the result, relevant trace, artifacts, effects,
   approvals, failures, and verification outcome.
8. **Evaluate learning.** Decide whether the evidence warrants no change, a
   temporary adaptation, a user-level improvement, or a candidate pack change.

A background run does not use a weaker contract merely because no human is
present. It may proceed only where the user's policy has already authorized its
effects and recovery behavior.

### Run intents and transitions

Soter uses one runtime with four explicit run intents. The intents share core
services and evidence formats but define different boundaries for what the run
may change:

| Intent | Purpose | Default change boundary |
|---|---|---|
| **Inspect** | Explain, diagnose, audit, or report health. | Read-only. |
| **Operate** | Perform work using the configured harness. | Operational data and effects authorized by the selected automation. |
| **Configure** | Install or remove selectable packs and change user settings, bindings, authorities, or policies. | User configuration, not pack definitions. |
| **Develop** | Create or modify packs, contracts, evaluations, adapters, and other harness definitions. | Harness artifacts through kernel-governed authoring and verification. |

How a run begins is recorded separately from its intent. A run may be
user-requested, scheduled, event-triggered, or evidence-triggered. Natural
improvement is therefore an evidence-triggered development run, not a separate
runtime and not an operational run silently rewriting itself.

An operational run may emit an observation or improvement candidate. Any
durable pack change happens in a separate development run with its own envelope,
effect boundary, tests, and promotion policy. Configuration changes similarly
remain distinct from changes to the packs themselves.

A run may transition automatically to an equally or less powerful intent, such
as operation pausing for inspection. A transition that expands what may be
changed requires an existing policy grant or confirmation. The runtime must
show and record the proposed transition; an agent cannot acquire development
authority merely by deciding that the harness should change.

If the requested intent is ambiguous, Soter may inspect or propose a course of
action, but it must resolve the ambiguity before entering configure or develop.
CLI, graphical interfaces, and agents expose the active intent so the user can
always tell whether Soter is doing work, changing its configuration, or
changing itself.

### The run envelope

Core creates a durable run envelope that makes an execution reproducible and
resumable. It contains at least:

- A run identifier, requested outcome or trigger, initiation type, run intent,
  and current lifecycle state.
- The automation identifier and version.
- A snapshot or content hash of the resolved user configuration.
- The required contract versions and complete transitive dependency set.
- Context authority references, provenance, freshness, and fingerprints.
- The selected capability and integration bindings.
- The host, host adapter, and behavior-relevant runtime versions.
- The applicable effect policy, approvals, and autonomy grants.
- Checkpoints, outputs, external effect identifiers, and verification evidence.

The envelope stores references and fingerprints where copying canonical data
would be unsafe or misleading. Secrets are never captured in it. If an agent's
working context is compacted, a process is resumed, or another compatible host
takes over, core rehydrates from the envelope and the declared authorities
rather than relying on conversational memory.

Mutable dependencies such as live schemas and templates must carry a
fingerprint or version. A change to any behavior-relevant transitive dependency
can make earlier verification stale. Soter reports that invalidation instead
of continuing to display an unexplained passing result.

### Context assembly

An automation declares the context contracts it needs. Core resolves those
contracts from user input, configured authorities, and outputs already produced
within the run. It loads progressively so that an agent receives the smallest
useful view first and can request additional declared context when needed.

Authority contracts determine precedence; file location or retrieval order do
not. If two sources disagree, core follows the declared authority rule and
records the conflict. If a required source is missing, stale beyond its policy,
or ambiguous, the run stops or enters an explicitly permitted degraded mode.
It never silently substitutes model memory for required context.

### Authority roles and change contracts

Whether a source is inside or outside the harness does not determine its
authority. A context contract assigns explicit roles to the relevant sources:

- **Definition authority** owns canonical meaning, rules, and lifecycle.
- **Instance authority** owns live records or operational state.
- **Provider authority** owns a service's schema, constraints, and available
  capabilities.
- **Projection** is a rendered, synchronized, or cached representation whose
  canonical source lives elsewhere.
- **Evidence authority** owns the run, evaluation, and outcome records used to
  support health and improvement claims.

One source may serve several roles, but each behavior-relevant fact must resolve
to one canonical authority unless a merge contract explicitly defines how
several authorities combine. The authority declaration also states freshness,
availability, and conflict behavior.

Anything that may be edited carries a change contract. It declares:

- The target and canonical authority.
- Which fields or behaviors may change and which must be preserved.
- Which actor, automation, or integration may propose or apply the change.
- Whether editing is direct, proposal-only, generated, or synchronized.
- The fetch, merge, conflict, and write behavior for mutable external state.
- Required validation, evaluations, and outcome evidence.
- The applicable effect and autonomy policy.
- Versioning, projection refresh, rollback, and recovery behavior.

If a policy is canonical in a Soter pack and published to Notion, the Notion
page is a projection: edit the definition authority, validate it, then refresh
the projection. If Notion is the declared definition authority, edit it through
the configured integration's fetch-merge-write contract and refresh the
harness's fingerprint or cache. Soter never chooses between internal and
external copies based only on location.

A development run uses these same contracts when changing Soter itself. The
kernel supplies the authoring, evaluation, and promotion mechanisms; the
runtime supplies authority resolution, effects, and evidence. Self-development
is therefore governed work performed by the same architecture, not a privileged
side channel.

### Effects and autonomy

Human confirmation is one possible control, not the architecture's permanent
default. Every effect declares the dimensions needed to apply a policy:

- The operation and target.
- The data sensitivity and possible disclosure.
- The scope and potential blast radius.
- Whether it is reversible, compensatable, or irreversible.
- Its idempotency and safe retry behavior.
- The evidence required to verify success.

Core combines that declaration with the user's policy, the system's maturity,
and the current run state. The result may deny the effect, request confirmation,
allow it once, or allow it under a durable and revocable grant. An automation
or agent cannot grant itself greater authority.

Autonomy is assigned per effect or change class, not as a blanket trust level
for an entire agent. A mature read-only routine may run unattended while a
rare irreversible action in the same automation remains gated. Grants can be
narrowed or revoked, and autonomous effects must still emit evidence and honor
configured limits, monitoring, and recovery behavior.

### What learning means

Learning is a durable improvement supported by run evidence. It is not the
model remembering a conversation, and it is not permission to rewrite the
harness after every surprising result.

Soter distinguishes three scopes:

- **Run adaptation** changes the plan inside one run without changing its
  declared outcome, authority, or effect boundary. It expires with the run.
- **User learning** improves the user's private configuration, preferences,
  bindings, or local guidance. It may become automatic when the change class
  is low-risk, reversible, and explicitly authorized.
- **Pack evolution** changes shared contracts or system behavior. It requires
  reproducible evidence, regression coverage, compatibility review, and the
  pack's promotion policy before distribution.

Host memories and prior conversations may help surface observations, but they
are neither canonical evidence nor a source of required policy. A proposed
durable change must point back to inspectable run evidence.

### Improvement loop

The improvement loop is:

```text
observe → diagnose → reproduce → propose → evaluate → trial → promote → monitor
                                                                    ↘ rollback
```

An observation becomes a candidate only when it identifies the affected
contract and the promised behavior that diverged. Before promotion:

1. Reproduce the divergence or establish why a single high-impact event is
   sufficient evidence.
2. Add or update an evaluation that fails for the observed reason.
3. Prefer correcting or consolidating an existing artifact over creating a new
   rule, guide, or exception.
4. Test the candidate across affected contracts, hosts, and integrations.
5. Compare outcomes over enough trials to distinguish improvement from
   stochastic variation.
6. Use a dry run, shadow, canary, or other contained trial when live behavior
   could create meaningful effects.
7. Promote only within the authority granted for that change class.
8. Monitor the promised outcome and roll back when the evidence regresses.

Confidence comes from reproducibility, representative evaluations, contained
trials, and observed outcomes—not from an agent's self-assessment. Evidence
from one user may improve that user's harness quickly without automatically
changing a shared pack for everyone.

### Guarding against slop and friction

The learning system must make improvement cheaper without making accumulation
easy:

- No observation writes directly to a canonical pack.
- Similar candidates are deduplicated before new artifacts are proposed.
- Temporary hints and workarounds carry freshness or retirement conditions.
- Every durable addition states which existing artifact could not express the
  behavior.
- Promotions must improve their target evidence without regressing established
  behavior.
- Low-risk, reversible user changes can be pre-authorized; repeated approvals
  for an already bounded change are a policy-design failure.
- High-impact or weakly evidenced changes remain supervised until their change
  class earns narrower, explicit autonomy.

The initial implementation may keep more changes supervised while evidence is
scarce. Human involvement should decrease through demonstrated reliability and
revocable policy, not through confidence alone.

## Configuration and distribution

The user controls which selectable systems make up their harness. Soter may
recommend a configuration and explain its reasoning, but it must not hide an
optional system, binding, authority, or permission inside an implicit default.

Configuration and distribution use the same pack contracts. Configuration
selects and binds packs for one user; distribution makes those packs and useful
starting configurations available to others.

### Configuration model

Soter keeps four forms of state separate:

| State | Purpose | Human-editable | Shareable |
|---|---|---|---|
| **Desired configuration** | Records the base, selected packs, settings, bindings, authorities, portable sources and consumers, and policies the user wants. | Yes | Yes, with private values parameterized or removed. |
| **Resolved lock** | Pins exact pack versions, manifests, owned artifact contents, contract graph, portable source inputs and fingerprints, and behavior-relevant projections. | Generated | Yes, when exact reproduction is desired. |
| **Runtime state** | Records authentication status, reachability, health, evidence freshness, and active runs. | Through Soter operations | No assumption of portability. |
| **Secrets** | Supplies credentials and sensitive values through an approved secret provider. | Outside ordinary configuration | Never. |

A user may maintain several named configurations for different purposes and
switch between them explicitly. Soter does not invent hidden personal, team,
or organization precedence. The active configuration and every imported value
must be inspectable.

An illustrative desired configuration might express:

```yaml
base: soter
packs:
  - context.crm
  - automation.meeting-intake
  - integration.notion
  - integration.otter
bindings:
  crm.records: integration.notion
  meeting.transcript: integration.otter
sources:
  source.policy.tasks:
    capability: documents.content.read
    authority: crm.definition
    input: { uri: notion://tasks-policy, expectedTitle: Tasks }
    readiness: probe-read
    consumer: automation.meeting-intake/applicable-policy
authorities:
  crm.records: notion://configured-database
policies:
  external-write: confirm
host: codex
```

The YAML above is conceptual shorthand. The normative v1 desired-configuration
shape is [soter/contracts/configuration.schema.json](./soter/contracts/configuration.schema.json),
with a complete example at
[soter/configurations/meeting-intake.config.json](./soter/configurations/meeting-intake.config.json).
The versioned schema, rather than rendered YAML or UI labels, determines the
field names and validation contract.

A configuration source is explicit wiring, not a new layer or a copy of the
underlying data. It declares one stable `source.*` identity, portable capability,
bound authority, exact capability input, readiness mode, and one or more selected
pack consumers with a purpose, subject scope, and reason. The canonical content
may live inside the harness or externally; the source declaration tells Core how
to obtain it. `runtime-only` sources are used only by an actual run. A
`probe-read` source additionally permits a safe, expiring readiness read when the
capability has only allowed `read` and `disclosure` effects.

A pack that cannot operate without configured sources declares
`sourceRequirements` in its manifest: purpose, capability, authority role and
subject, and minimum/maximum cardinality. This prevents a configuration from
resolving successfully with a capability binding but no concrete source input.

Kernel validates every source input against the exact capability schema, keeps
its authority inside the selected binding, rejects consumers that are not
selected or do not declare that capability requirement, and rejects unsafe
readiness modes. The resolved lock fingerprints the input and consumer wiring.
Core gives an Automation the consumer declarations it owns, but projects only
provider-neutral source identity, capability, authority, input, and fingerprint
to an Integration probe. An Integration must never depend on an Automation's
settings shape.

A Context pack that owns portable records declares a
`context-record-model/v1`. The model gives each record type and field one
canonical meaning, value shape, create requirement, nullability, mutability,
relationship identity, content kind, and set of valid deduplication fields.
Kernel requires the definition to be an artifact of its exact Context pack.
Core validates CRM inputs and normalized outputs against that model before a
fixture or connected provider can establish a passed capability invocation.
Automation may propose only Context-declared fields; grounding and decision
evidence does not become a provider field merely because it was useful inside a
run.

`provider-mapping/v3` binds a typed provider mapping to one exact Context model.
Every mapped record and portable field must exist in that model, list versus
scalar decoding must preserve its value shape, and mapped page content must
preserve the declared content kind. A mapping may intentionally implement only
a subset. Each record type therefore declares its own read, create, and update
scope; the mapping-level CRM capabilities are the exact union. Create scope
requires every Context-required field and body mapping, while generic update
scope cannot expose an immutable Context field. That subset is provider
capability, not domain meaning: a valid
Context field that is absent from the selected mapping remains visibly
unrepresentable and fails compilation before approval.

The normative Core state shapes are the
[resolved lock](./soter/contracts/lock.schema.json),
[run envelope](./soter/contracts/run-envelope.schema.json),
[context snapshot](./soter/contracts/context-snapshot.schema.json),
[scoped approval](./soter/contracts/approval.schema.json),
[connected operation-batch approval](./soter/contracts/approval-v2.schema.json),
[change set](./soter/contracts/change-set.schema.json),
[connected operation batch](./soter/contracts/connected-operation-batch.schema.json),
[private connected transaction checkpoint](./soter/contracts/connected-transaction-checkpoint.schema.json),
[host tool call](./soter/contracts/host-tool-call.schema.json),
[provider probe call](./soter/contracts/provider-probe-call.schema.json),
[provider probe plan checkpoint](./soter/contracts/provider-probe-plan-checkpoint.schema.json),
[failed provider probe attempt](./soter/contracts/provider-probe-attempt.schema.json),
[durable host call checkpoint](./soter/contracts/host-call-checkpoint.schema.json),
[fixed-input sequential operation plan](./soter/contracts/operation-plan.schema.json),
[fixed-input durable operation-plan checkpoint](./soter/contracts/operation-plan-checkpoint.schema.json),
[bound sequential operation plan](./soter/contracts/operation-plan-v2.schema.json),
[bound durable operation-plan checkpoint](./soter/contracts/operation-plan-checkpoint-v2.schema.json),
[evidence record](./soter/contracts/evidence.schema.json), and
[doctor result](./soter/contracts/doctor-result.schema.json). Connected
integrations produce short-lived, secret-safe
[single-call provider probes](./soter/contracts/provider-probe.schema.json) and
[exact-check provider probes](./soter/contracts/provider-probe-v2.schema.json)
as private runtime state rather than portable configuration. Portable record
meaning uses the
[Context record model](./soter/contracts/context-record-model.schema.json), and
Context-bound typed provider mappings use the
[provider mapping v3 contract](./soter/contracts/provider-mapping-v3.schema.json).
The generated
[meeting-intake fixtures](./soter/fixtures/meeting-intake/) show how those
documents link while distinguishing local fixture-provider behavior from
connected or live provider behavior.

### Required base and selectable packs

Every configuration includes a conforming kernel and the minimum core systems
required to resolve, execute, verify, and explain the harness. The base contract
lists those required packs explicitly. A user can inspect them and understand
why they are required, but cannot remove one while claiming the configuration
still conforms to that base.

The core layer may also contain optional extensions. Context, automation, and
integration packs are selectable unless another selected pack declares them as
required dependencies. Users must be able to ask what a pack enables, why it is
installed, what it costs or exposes, and what depends on it.

Adding or removing a pack is a configuration operation. Before applying it,
Soter resolves and displays:

- The exact configuration change.
- New, removed, or changed dependencies and capability bindings.
- Required authorities, credentials, permissions, and effects.
- Compatibility or migration consequences.
- Evidence that will become stale and checks that must be rerun.
- Behavior that will become available, degraded, or unavailable.

Soter refuses a change that would leave a required connection unresolved unless
the user also selects a valid replacement or removes the dependent behavior.

### Recommendations and bundles

A user may describe a goal rather than know which packs to select. Soter can
recommend individual packs or a bundle, but every recommendation explains:

- Which user goal it supports.
- Why each pack is included.
- Which alternatives exist and why one may be preferable.
- The maturity and compatibility of the recommendation.
- The data, integrations, permissions, and potential effects involved.
- Which parts are required and which are optional.

A bundle is only a versioned, named recommendation of compatible packs and
starter settings. It expands into an ordinary desired configuration; it adds
no hidden runtime behavior. The user may inspect, customize, export, or fork it.
Changing a bundle later does not silently alter configurations previously
created from it.

### Resolution and realization

Core resolves the desired configuration into one compatible graph and produces
the lock. Resolution includes pack dependencies, contract versions, capability
bindings, authority roles, effect policies, host support, and migrations. The
lock fingerprints every declared pack artifact as well as its manifest so a
guide, implementation, scenario, contract, or projection change becomes
visible drift. Secret references and values are excluded from the shareable
lock.

A capability binding selects one integration pack and an explicit allowed set
of authorities. Each invocation chooses exactly one member of that set. The
run's containment level then selects one matching
[capability-provider implementation](./soter/contracts/capability-provider.schema.json)
from the bound pack. Fixture data uses its own
[provider-fixture contract](./soter/contracts/provider-fixture.schema.json), so
local test data cannot masquerade as connected provider state.

A host adapter then realizes the resolved configuration through the host's
native files and features. Generated Codex or Claude instructions, skills,
hooks, plugin metadata, and tool configuration are projections of the lock.
Manual edits to a generated projection are either rejected or reported as
drift; they do not become a second configuration authority.

The same resolution engine serves agents, CLI commands, and graphical
interfaces. Implementations may present different interactions, but these
operations have one structured contract:

- Inspect and explain the active configuration.
- Recommend, add, remove, replace, or configure packs.
- Preview and apply a configuration diff.
- Resolve, validate, and lock the complete graph.
- Check connection and runtime readiness.
- Export a reusable template or exact lock.
- Upgrade, migrate, roll back, or diagnose drift.

### Pack distribution contract

A distributable pack contains everything needed to inspect and verify the
system without relying on its author's conversation history:

- A system contract and versioned public interfaces.
- Its owned artifacts and canonical documentation.
- Dependency, capability, authority, effect, and configuration declarations.
- Evaluations, fixtures, and expected evidence.
- Host or integration implementations where the layer requires them.
- Compatibility ranges and supported migration paths.
- Publisher, source, license, integrity, and provenance information.
- Maturity, known limitations, and deprecation state.

The pack format is independent of whether packs are distributed through a Git
repository, local path, marketplace, package registry, or another transport.
Those channels must preserve the same identity, integrity, and contract data.

At minimum, maturity distinguishes:

- **Experimental:** under development; limited evidence and conservative
  autonomy.
- **Preview:** contract and evaluations are usable, but real-world evidence or
  compatibility coverage remains limited.
- **Stable:** supported contracts and representative evidence meet the stated
  release bar.
- **Deprecated:** still resolvable for a defined period, with a documented
  replacement or removal path.

Maturity is an evidence claim, not a branding label. A stable pack can become
unverified or unhealthy when dependencies drift.

### Install and upgrade lifecycle

Installing a pack or bundle follows a visible lifecycle:

1. Discover the candidate and its source.
2. Inspect its purpose, dependencies, authorities, effects, maturity, and
   requested permissions.
3. Preview the desired configuration and resolved graph changes.
4. Accept the configuration change under the user's policy.
5. Fetch and verify the selected versions and integrity information.
6. Configure bindings, authorities, and secret references.
7. Realize the configuration for the selected host.
8. Run the required checks and report valid, ready, verified, and healthy
   states separately.

Upgrades are never silent. Soter previews changed contracts, migrations,
permissions, effects, projections, and invalidated evidence before applying an
upgrade. Applying the new lock and its generated projections is atomic where
possible. The prior lock remains available for rollback, subject to declared
data migrations and external effects that cannot be reversed.

### Sharing and collaborative evolution

Users can share a desired configuration as a reusable template or share its
lock for exact reproduction. Export replaces private authority locations and
secret references with documented parameters unless the user explicitly
chooses otherwise. Recipients can inspect the full proposed graph before
realizing it on their own host and integrations.

Collaborative improvement happens through pack evolution, bundles, reusable
configurations, evaluations, and opt-in evidence—not by pooling private runtime
state. A contribution identifies its affected contract, includes a reproducer
or evaluation, records provenance, and states the compatibility and migration
impact.

Users decide whether to contribute observations or evidence. Soter must support
redaction and minimization before evidence leaves a user's environment. Shared
evidence can justify a candidate change, but publication still follows the
pack's evaluation and promotion policy. A user remains free to keep a private
fork or local system without making it part of the shared distribution.

## Hosts, integrations, and interfaces

Soter separates the agent host, the external providers, and the interfaces a
person uses to control the harness. All three consume the same resolved
configuration, contracts, policies, run envelopes, and evidence. None may
quietly redefine them.

### Host adapter contract

Codex, Claude, and future agent runtimes expose different native mechanisms.
A host adapter realizes Soter through those mechanisms while preserving the
same system semantics and effect boundaries.

Every host adapter must account for:

- Loading durable project and user guidance.
- Discovering and invoking the selected systems and automations.
- Registering integration capabilities and their dependencies.
- Running deterministic lifecycle enforcement where the host supports it and
  supplying an equivalent core boundary where it does not.
- Applying effect policy and returning approval decisions to core.
- Preserving and rehydrating the run envelope across compaction, restart,
  retry, or handoff.
- Supporting interactive, headless, scheduled, and event-triggered runs where
  the adapter claims those capabilities.
- Isolating development runs from the active configuration and unfinished
  work.
- Returning structured traces, artifacts, external effect identifiers, and
  verification evidence.
- Reporting unsupported or degraded behavior before a run depends on it.

Current host projections may include:

| Concern | Codex projection | Claude projection |
|---|---|---|
| Durable repo guidance | `AGENTS.md` | `CLAUDE.md` |
| Reusable workflows | Agent skills | Claude skills |
| Lifecycle enforcement | Codex config and hooks | Claude settings and hooks |
| Distribution | Codex plugin package | Claude plugin package |
| External tools | MCP servers, apps, and connectors | MCP servers and plugins |

These paths and native features are implementation details owned by their host
adapters. Soter's canonical definitions remain provider-neutral. If a host
adds, removes, or changes a mechanism, only the adapter and its conformance
evidence should need to change.

A host adapter cannot claim support by replacing a required deterministic gate
with prose and hoping the agent follows it. When a host lacks a native hook,
approval, scheduler, or persistence feature, the adapter must supply the
behavior through core, declare a visible limitation, or mark the configuration
unsupported.

### Host conformance

Supporting a host means passing behavior-level conformance scenarios. At
minimum, the adapter proves that it can:

1. Realize the resolved configuration without introducing an undeclared
   system or effect.
2. Invoke an automation with its required context and integration bindings.
3. Enforce a denied, confirmed, and pre-authorized effect correctly.
4. Rehydrate a run after context compaction or process restart.
5. Preserve run and evidence identifiers across retries and handoffs.
6. Execute a contained development run without mutating the active harness.
7. Report capability gaps and stale generated projections accurately.

Conformance evidence is tied to the adapter, host version range, base version,
and affected transitive contracts. It becomes stale when any of those inputs
change materially.

### Integration capability contract

An integration pack implements one provider in the integration layer. It may
expose several versioned capabilities, such as querying records, updating a
document, reading a transcript, drafting a message, or subscribing to an event.

A capability contract declares:

- A stable identifier, version, purpose, and portability level.
- Typed inputs, outputs, pagination, and relevant size or rate constraints.
- Required authentication and minimum permission scopes.
- Read, disclosure, write, dispatch, and destructive effect annotations.
- Idempotency, retry, timeout, checkpoint, and compensation behavior.
- A normalized error model covering authentication, authorization, validation,
  conflict, rate limit, unavailable, retryable, and unknown failures.
- Provenance and freshness returned with data.
- Health checks, fixtures, contract tests, and any contained live verification.
- Provider limitations that an automation or user must understand.

Capability contracts should be stable and meaningful, not a lowest-common-
denominator disguise. When an automation intentionally requires a unique
provider feature, it declares that provider-specific capability and the
resulting portability limitation rather than hiding the dependency.

MCP is a preferred standard transport when a provider supports it, but it is
not itself the Soter capability contract. Integrations may also use an app
connector, SDK, CLI, local process, or direct service API. The integration pack
normalizes whichever transport it uses into the declared capability and effect
model.

Provider-specific field semantics and user-specific target identities are
separate contracts. An integration-owned provider mapping declares how
portable record types and fields correspond to provider fields. Mapping v2 also
declares the provider property type used by schema checks, so a renamed field,
relation converted to text, or status converted to select fails mechanically
instead of surfacing later as a misleading empty or malformed record. A pack-owned
settings definition validates the selected user's target identifiers and other
desired configuration under `settings[pack-id]`. Mappings are shareable pack
content; target identities are configuration. Neither belongs in an automation
prompt or host projection.

Exact provider resources consumed by other packs use configuration `sources`
rather than Integration settings. This keeps a document URI and portable input
independent of the provider translator while making every consumer and readiness
read explicit.

Portable record outputs include a provider version, revision, or deterministic
content fingerprint whenever later compare-before-write or freshness logic may
depend on the observed state. Absence of a provider-native revision does not
permit Core to omit the concurrency boundary; the integration derives a stable
fingerprint from the normalized record it actually observed.

### Host-dispatched MCP contract

MCP-backed provider execution is resumable rather than a hidden direct network
call from Core. A connected provider declaration names:

- The logical MCP server identity and allowlisted provider-neutral operations
  it may request.
- An integration-owned prepare function that translates capability input into
  one logical operation and argument object.
- An integration-owned completion function that normalizes the host response
  into the capability output contract.
- A narrower probe-tool allowlist plus either one-call prepare/completion
  functions or plan/step/finalize functions for non-mutating readiness
  observations.
- The exact provider, capability, authority, containment, and effects covered.

Core creates a `host-tool-call/v1` record before dispatch. The record binds the
request to the exact configuration lock, graph, host adapter, provider version,
capability version, authority, effect-policy decisions, input fingerprint,
logical server, provider operation, resolved native host tool, and argument
fingerprint. It contains no credential values. If policy blocks the effect or
the portable input is invalid, no tool or arguments may be emitted.

The host adapter maps each allowlisted logical operation to an exact native tool
name for its current connector, plugin, or project MCP registration. Core
performs this resolution before returning the requested call; the host invokes
only the resolved native tool. Host-qualified names such as Codex or Claude MCP
function prefixes are projections and must not appear in automation,
capability, or provider-mapping contracts. Tool discovery may inform an adapter
update, but it cannot silently substitute a newly discovered name at runtime.

After execution, Core accepts a result only for the exact outstanding request.
The integration normalizes it, Core validates the portable output, and the call
advances to completed or failed. The durable call record stores response and
output fingerprints rather than the raw provider body. A retry, resume, or
handoff therefore cannot substitute a different lock, provider, input, tool,
or response without detection.

Before a host receives a requested tool call, Core writes a
`host-call-checkpoint/v1` document to private runtime state. It binds the exact
call to its lock, graph, host, original portable input, and—where applicable—a
private durable run-envelope path and fingerprint. The checkpoint is
self-fingerprinted, written through an atomic private-file replacement, and
excluded from version control. Host credential values and native provider
response bodies are never written to it. A normalized portable result may be
stored because it is required to resume the run; the checkpoint remains private
operational state rather than shareable configuration or evidence.

Capability preparation also updates the durable run envelope to `executing`
and records the exact pending-call fingerprint. Completion or failure updates
the same checkpoint and adds one typed capability invocation to the run. The
run stores output fingerprints rather than normalized result bodies. Core
allows only one requested capability checkpoint per run, preventing a restarted
host from guessing which concurrent response belongs to the run.

After restart or compaction, an interface lists checkpoint summaries and loads
the exact checkpoint by ID. Completion takes only that ID and the native result;
Core reloads the original lock, run, call, and input from durable state. A stale
lock, wrong host, changed provider implementation, altered checkpoint, closed
run, or conflicting run checkpoint fails closed. Reading a stale checkpoint for
diagnosis remains possible, but it cannot authorize completion.

All interactive projections must use the same Core execution service. The
reference CLI and local Soter MCP server are transports over that service; they
must not reimplement lock freshness, run-envelope matching, policy evaluation,
provider selection, argument allowlisting, normalization, or failure
recording. The local Soter MCP server is a host interface, not a provider route:
it exposes the logical operation for explanation, emits the exact resolved
native tool request, and accepts a native result, but never invokes a provider
tool itself.

The generic capability and operation-plan services accept no caller-supplied
approval set. Consequently, a capability whose resolved effects require
confirmation produces a blocked call with no tool or arguments. Connected
writes use the separate transaction contract below. Host approval prompts alone
are not reusable Soter authorization.

The host-call checkpoint represents one native request. A provider feature that
needs several requests—multi-target reads, deduplication followed by creation,
compare-before-write, or read-after-write verification—must not hide that
sequence inside a translator or rely on provider plan features to collapse it.

Core's initial `operation-plan/v1` is the explicit multi-call boundary. It binds
one to fifty fixed-input capability steps to an exact run. Every step names its
capability, authority, provider implementation, portable input, and reason.
Steps execute sequentially under `failurePolicy=stop`; at most one native call
is requested, and all later steps remain pending. Each step travels through the
ordinary capability validation, binding, host-tool resolution, and effect-policy
path. A plan therefore cannot invent a provider route or widen authority.
Because every v1 input is fixed, Core preflights every step's binding, input,
provider translator, and host route before it emits the first call. An invalid
tail rejects the plan without creating a checkpoint or performing earlier
provider work. An effect-policy block remains an explicit blocked step rather
than becoming implied approval.

`operation-plan/v2` adds typed output-to-input bindings without adding a second
execution engine. A step still declares a portable fixed input, but it may also
declare one or more `inputBindings`. Each binding names an earlier source step,
an exact path through that step's normalized portable output, a previously
unset target path in the current input, the `unique-string-list` transform, and
an explicit `onEmpty` policy. A binding may never read a current or future step,
overwrite fixed input, traverse a fixed non-object value, or use a target path
that duplicates or overlaps another binding target.

Core resolves a bound input only after every named source output has completed
and normalized. It recursively follows explicit `*` array segments, accepts
only non-empty strings, removes duplicates, sorts the resulting list, and
fingerprints the source output, bound values, and final resolved input. The v2
checkpoint retains those resolutions so restart validation can derive and
compare them again from the exact prior outputs. Invalid types, missing paths,
tampering, or a changed resolution fail closed before a provider request is
emitted.

An empty binding is never interpreted as permission for a broad read.
`onEmpty=skip-step` records a terminal skipped step with no host call, provider
effect, or output; `onEmpty=fail-plan` records a deterministic plan failure.
Core can preflight every v2 step's selected provider, authority, effect policy,
module exports, and host route before the first request, but a data-dependent
input can pass its final capability and translator validation only when its
source output exists. A bad dynamic input therefore fails at that exact bound
step rather than being represented as fully preflighted.

Before emitting the first call, Core writes the corresponding private
`operation-plan-checkpoint/v1` or `operation-plan-checkpoint/v2`, bound to the
exact lock, graph, host, run, source plan fingerprint, ordered runtime steps,
and current call. Completion requires
both the checkpoint ID and exact current call ID. Core validates and normalizes
the response, fingerprints the portable output, atomically advances the private
plan checkpoint, and emits at most the next exact call. Core then synchronizes
the durable run and repairs it from the newer checkpoint if a process stops
between those writes. An exact replay of a completed call and response is
idempotent; a different, late, or guessed call or response fails closed.
Restart and compaction recovery load the same current call from private state
rather than reconstructing it from conversation.

An operation-plan checkpoint may retain normalized portable outputs because
later orchestration needs them, but it never retains the native provider body
or credential values. The run records each typed invocation plus output
fingerprints and the plan's current state. Plan state is private runtime state,
not configuration, pack content, or distributable evidence.

Version 1 remains the fixed-input contract. Version 2 currently supports only
the `unique-string-list` transform and sequential earlier-step references. It
does not add arbitrary expressions, branching, parallelism, fan-out, plan-level
retry policy, compensation, an approval-bound operation batch, or rollback.
The current prepare interface passes no approval set. Version 1 represents a
confirmation-gated write as a blocked step with no provider arguments; version
2 rejects a plan containing that unavailable effect before it checkpoints or
performs earlier reads.

Connected writes use a separate transaction boundary rather than widening the
general operation-plan interface. `connected-operation-batch/v1` compiles an
exact proposed change set against the selected connected provider and mapping.
Before checking provider representability, Core validates each portable input
against the mapping's exact Context record model.
Automation owns outcome-specific change-set construction and post-write
acceptance checks. Core owns approval matching, capability dispatch,
checkpointing, rollback mechanics, and the invocation of an Automation-owned
verifier; moving a routine into Core does not make its domain decisions generic.
Every operation carries its portable input, provider identity, compare-before-
write or deduplication precondition, read-after-write expectation, and recovery
mode. Unmapped fields fail compilation before approval or provider arguments.
An update can declare reverse-order restoration from its compared prior fields.
A create whose provider exposes no automatic compensation route remains a
blocked, non-executable batch even when its fields and deduplication filter are
otherwise representable.

`approval/v2` binds both the change-set scope fingerprint and the compiled
operation-batch fingerprint, names only the approved effects, and expires. A
changed input, binding, mapping, recovery plan, operation order, or batch
fingerprint requires a new approval. A blocked batch cannot be approved. The
compiler and preview command execute no provider calls.

`connected-transaction-checkpoint/v1` is the private durable execution boundary
for an executable update-only batch. Preparation requires the exact current
lock, graph, host, durable run, proposed batch, source change set, and unexpired
`approval/v2`. Core validates all fingerprints and emits only the first
compare-before-write read. Before that emission, it preflights every operation's
compare, write, verify, compensation, and compensation-verification binding,
input shape, provider translator, and native host route. An invalid tail fails
before an earlier effect. The checkpoint embeds the exact authorization sources
because resume must not reconstruct authority from conversation or a later
prompt. It stores no credential value or native provider response.

Each update proceeds sequentially through four explicit responsibilities:

1. Read the exact record and require the compiled expected version.
2. Capture only the mapped fields that the approved patch may overwrite.
3. Emit the approved update and then read the exact record again.
4. Require the approved fields to match and retain the observed version needed
   for possible compensation.

The first write must begin while the exact approval is current. Once an effect
has begun, expiry does not prevent verification or compensation; stopping
recovery because the initiating approval expired would increase risk. A changed
batch, change set, approval, lock, graph, host, provider route, checkpoint, call
ID, or completed-response fingerprint fails closed.

If a later compare conflicts or a deterministic read fails, Core compensates
every verified applied update in reverse order. Compensation restores the
captured prior mapped fields using the last observed version, then reads the
record and verifies that restoration. A successful reverse sequence closes as
`rolled-back`; it is not reported as successful completion. A failure before
any write closes as `failed`.

External providers do not supply an ACID boundary. A transport failure during a
write, a missing post-write record, an unverified compensation, or another
ambiguous effect closes as `needs-attention`. Core must not retry an ambiguous
write automatically or claim rollback.

An exact `needs-attention` checkpoint may begin read-only reconciliation. Core
binds each reconciliation attempt to the unresolved operation, ambiguity,
lock, graph, host, provider, authority, record ID, and checkpoint. It emits one
ordinary `crm.records.read` request and stores only the normalized result and
fingerprints. Reconciliation does not accept approval, emit provider arguments
for a write, or reuse the ambiguous call. Attempts are bounded to twenty per
operation so an unavailable or unstable provider cannot grow private state
without limit.

Core classifies the exact record observation as:

- `approved-fields` when every approved patched field has the approved value;
- `prior-fields` when every captured overwritten field has its compared value;
- `missing` when the exact record is absent;
- `diverged` when the record matches neither state; or
- `read-failed` when the reconciliation request cannot be completed and
  normalized.

For an ambiguous update or verification, `approved-fields` proves the desired
effect and resumes the remaining batch; `prior-fields` proves that operation
does not remain applied and begins or completes rollback of earlier verified
updates. For ambiguous compensation, only `prior-fields` proves restoration and
continues reverse recovery. Missing, divergent, read-failed, or still-approved
compensation state remains `needs-attention`. Core never converts those states
into an automatic write retry. A later read-only attempt may observe a stable
resolvable state; otherwise a human must reconcile provider state before a new
operation batch and approval are created.

Mapped creates remain non-executable while the selected provider declares no
automatic compensation route. Generic capability and operation-plan interfaces
still accept no connected-write approval. The trusted CLI can create an exact
approval and start the transaction. CLI and MCP can load, complete, fail, or
request read-only reconciliation of the already-authorized checkpoint by exact
checkpoint and current-call identity; MCP still cannot originate or widen
approval.

#### Bounded connected context finalization

Meeting intake uses the operation-plan service as its connected context
transport; it does not introduce a second provider execution path. Automation
derives the selected connected provider implementations and authorities from
the exact lock, then generates an `operation-plan/v2` with a configured set of
fixed sources followed by three reference-bound sources:

1. A bounded CRM policy index read under the definition authority.
2. One exact `documents.content.read` for every configuration source consumed by
   the Automation for `applicable-policy`. Each source declares a stable ID,
   capability input, definition authority, governed subjects, and applicability
   reason. Policy source IDs and document URIs are unique; several policies may
   govern the same subject so internal and external rules can be grounded
   together.
3. The exact transcript selected by meeting ID and canonical recording URI.
4. A CRM meeting read filtered by that same recording URI with a limit of two,
   so zero matches and duplicate matches remain distinguishable.
5. Only the organization record URIs returned by that meeting, or a skipped
   step when the meeting has no organization relations.
6. Only the project record URIs returned by those organizations, or a skipped
   step when no project relations were observed.
7. Only the task record URIs returned by those projects, or a skipped step when
   no task relations were observed.

The plan is preflighted and checkpointed like any other operation plan. The
host completes each emitted request through the generic plan completion
contract. A process restart does not change which source is current or which
host-native tool and arguments are allowed.

Context finalization is a local Automation transition backed by a Core commit
and accepts only the completed exact plan. Automation requires the typed policy
index to identify each configured policy exactly once by URI and title, and each
page result to return that same identity, a non-empty bounded Markdown body, and
its recomputed body fingerprint. It also requires a non-empty transcript whose
segments reference known speakers and exactly one typed CRM meeting whose
normalized recording URI equals the transcript request. Every non-skipped
related step must return every and only the referenced record IDs of its expected
CRM type. Provider query filtering alone is not accepted as proof of identity,
and a referenced record that is missing from the normalized result prevents
finalization. Missing, empty, duplicate, mismatched, stale-lock, wrong-host,
failed, blocked, or incomplete required sources fail before a context snapshot
is written.

Core requires every entry in the resulting `context-snapshot/v1` to match
exactly one normalized completed-plan output, its subject and role to match the
declared run authority, and its effect set to match all passed plan effects
before writing private restricted runtime state and synchronizing the run.
Repeating finalization with the same completed plan is idempotent; a conflicting
snapshot or run output fails closed. The run records the snapshot fingerprint,
marks the completed CRM definition, CRM instance, and transcript context sources
loaded for this snapshot, and pauses before writes. Policy snapshot entries carry
machine-readable `applicability` with the configured subjects and reason.
Skipped relationship steps contribute no snapshot entry or effect. The loaded
definition authority proves exact configured selection, normalized page content,
and provenance; it does not prove that policy prose was correctly interpreted or
enforced.

This snapshot is bounded grounding, not complete meeting-intake context. It
loads only the explicitly bound policy pages, the selected meeting, and its
observed organization-to-project-to-task chain; it does not load participant
profiles or infer additional policies from the workspace. Meeting participant
identifiers are provider People IDs and are not assumed to be CRM contact page
URIs. Policy interpretation and participant expansion require their own
judgment, identity, authority, and disclosure contracts. A private connected
snapshot is not a provider probe, checked-in evidence, readiness result,
live-health result, or proof that a host autonomously executed the plan.

Provider readiness uses a state machine separate from domain capability runs.
Core derives the observation scope from the exact lock and desired
configuration, including the selected provider, secret-reference identifiers,
authorities, and capabilities. The integration may choose only tools in its
narrower `probeTools` allowlist.

Core separately selects exact configuration sources whose readiness mode is
`probe-read` and whose capability and authority belong to that provider binding.
It gives the Integration only the provider-neutral source fields; consumer pack,
purpose, and applicability metadata remain outside the Integration boundary.

A provider may implement the legacy single-call `provider-probe-call/v1`
handshake or an explicit sequential
`provider-probe-plan-checkpoint/v1`. A probe plan records each semantic scope,
logical operation, resolved native host tool, arguments, and fingerprint before
emitting at most one `currentCall`. Every completion supplies the exact
checkpoint and call IDs. Core rederives the complete plan from the current lock
before accepting a response, persists only the integration's minimized step
result, and then emits the next request or stops. The integration cannot hide a
multi-request probe inside one translator call.

After all steps complete, the integration returns typed observations rather
than a readiness verdict. Core checks that credentials, authorities,
capabilities, and one check per exact plan step cover neither more nor less than
the locked plan, then assembles `provider-probe/v2`. Each check binds its step,
kind, subject, scope fingerprint, safe method, and minimized expected/observed
fingerprints. This separation prevents identity or metadata requests from being
recorded as domain invocations and prevents an adapter from widening readiness
claims.

Probe-call and probe-plan records contain request, response, scope, minimized
result, and normalized-probe fingerprints, never provider response bodies. A
successful identity request may establish authentication and endpoint
reachability while leaving a capability `unknown`. File-based CLI completion
accepts native results only from an absolute private path whose real target is
outside the repository; the caller deletes that transient input after
completion. A provider response file cannot become pack content, desired
configuration, runtime evidence, or a committed fixture. Capability
compatibility becomes `passed` only when every exact required check observes
enough safe behavior to support that claim. Probe success never implies write
permission, write behavior, automation verification, or live health.

### Binding automations to integrations

Automations depend on capabilities, not tool names or provider call sequences.
The user configuration binds each requirement to one integration and authority.
For example:

```text
automation.meeting-intake
  requires meeting.transcript.read
  requires crm.records.create

meeting.transcript.read → integration.otter → configured meeting authority
crm.records.create      → integration.notion → configured CRM authority
```

Core validates capability and contract versions before execution. The
integration owns authentication, transport, provider translation, and typed
failure handling. The automation owns the user outcome, orchestration, and
recovery choices that have business meaning.

Several providers may implement the same capability, and one provider may
fulfill several capabilities. A binding may be replaced without changing the
automation when the replacement satisfies the same contract. Provider-specific
schema mapping remains explicit configuration or an owned integration artifact;
it cannot hide in a prompt.

### Shared interface model

Core exposes one versioned structured model for:

- Packs, bundles, configurations, locks, and dependency graphs.
- Authorities, capabilities, bindings, permissions, and effect policies.
- Runs, intents, envelopes, checkpoints, outputs, and external effects.
- Evaluations, evidence, health, drift, and improvement candidates.
- Configuration diffs, migrations, approvals, upgrades, and rollback.

This model may be implemented as an in-process API, service API, command
protocol, event stream, or combination. Its schemas and state transitions are
canonical; rendered text and screens are not.

The primary interfaces are:

- **Agent interface:** structured tools for inspecting, configuring, running,
  and developing the harness within the active run's authority.
- **CLI:** human-readable commands plus stable machine-readable output, exit
  states, and identifiers for scripting and diagnosis.
- **Graphical interface:** configuration builder, pack and dependency browser,
  run timeline, approval queue, health view, evidence explorer, and improvement
  candidate review.
- **Automation interface:** triggers and callbacks that start or resume the same
  runtime lifecycle without relying on an interactive terminal.

Starting with a CLI does not make the CLI the source of truth. A graphical
interface should call the same operations and display the same state, while the
CLI should expose structured output from those operations rather than
reconstructing state from prose.

### Interface consistency

Business rules, graph resolution, effect decisions, and health calculations
live in core. Interfaces may validate input for usability but cannot implement
different acceptance rules. Every mutation returns the resulting configuration
version, lock, run identifier, or evidence identifier so another interface can
observe the same change.

Contract tests exercise equivalent actions through each supported interface
and compare the structured result. For example, removing a pack through the UI,
CLI, or agent interface must produce the same dependency impact, configuration
diff, validation outcome, and new lock. A mismatch is an interface conformance
failure, not a documentation issue.

Interfaces can cache data for responsiveness only when they preserve version
and freshness information. Stale views are marked and refreshed from core;
they never become an alternative authority.

## Verification and health

Soter never represents “the checker passed” as proof that the harness works.
Verification is a set of scoped claims supported by inspectable evidence, and
health is recent evidence that configured systems achieve their promised
outcomes in real use.

Every result answers three different questions:

1. What claim was evaluated?
2. Which exact configuration, contracts, authorities, host, and integrations
   were evaluated?
3. What evidence supports the result, and is that evidence still applicable?

### Verification ladder

Verification progresses from cheap, deterministic checks toward contained live
behavior:

| Level | Purpose | Typical evidence |
|---|---|---|
| **Static validation** | Check manifest, schema, naming, required fields, and local invariants. | Deterministic diagnostics tied to content hashes. |
| **Graph validation** | Resolve dependencies, capabilities, authorities, effects, compatibility, and layer rules. | Resolved graph and conflict paths. |
| **Contract and fixture tests** | Prove deterministic components and adapters against controlled inputs. | Assertions, fixtures, typed results, and failure cases. |
| **Agent scenario evaluations** | Test judgment, instruction following, orchestration, exclusions, and pressure behavior. | Multiple trial artifacts, traces, evaluator results, and outcome distribution. |
| **Contained integration checks** | Verify authentication, schemas, provider behavior, and safe reads or writes. | Sandbox, test-tenant, read-only, or reversible effect evidence. |
| **Live canaries** | Prove a narrowly scoped real effect where simulation cannot establish the claim. | Pre-authorized effect identifiers, verification, cleanup, and rollback evidence. |
| **Runtime monitoring** | Establish that the configured system remains useful and reliable over time. | Outcome verification, failures, retries, drift, latency, and policy violations. |

Not every system requires every level. The applicable ladder depends on its
contracts, effects, maturity, host claims, and integration bindings. A level
that is not applicable is declared as such; it is not silently skipped.

### Verification claims and evidence

A verification claim identifies the promised behavior and its acceptance
criteria. Examples include “this configuration resolves without ambiguity,”
“this adapter rehydrates after compaction,” and “this automation creates one
correctly shaped record without duplicating an existing one.”

An evidence record contains at least:

- A stable evidence identifier and the claim being evaluated.
- The subject pack, configuration lock, complete relevant dependency set, and
  their versions or fingerprints.
- The host, host adapter, integrations, authority fingerprints, and
  behavior-relevant runtime versions.
- The evaluator or check definition and its version.
- The environment, containment level, inputs, trials, and acceptance threshold.
- Structured outcomes, artifacts, traces, external effect identifiers, and
  cleanup or rollback results.
- Failures, warnings, skipped work, and known limitations.
- Creation time, freshness policy, superseding evidence, and privacy scope.

Evidence is append-only or explicitly superseded. Editing an old result to
match a new claim destroys its value. A golden artifact is a useful comparison
baseline, not permanent truth and not a substitute for the evidence record
that explains how it was produced.

### Result states

Each applicable claim reports one of these states:

- **Passed:** the acceptance criteria were satisfied by applicable evidence.
- **Failed:** the acceptance criteria were evaluated and not satisfied.
- **Stale:** evidence once applied, but a relevant dependency or freshness
  boundary changed.
- **Unknown:** the claim lacks enough evidence to determine a result.
- **Skipped:** the check was applicable but did not run, with a recorded reason.
- **Not applicable:** the claim does not apply under the resolved contracts.

`Skipped`, `unknown`, and `stale` are not aliases for passed. A roll-up uses the
most conservative state among required claims and identifies the exact blocking
path. Optional failures or unknowns may produce a degraded state, but the
unavailable behavior remains visible.

### Transitive freshness and invalidation

Verification freshness follows the contract graph, not only the file directly
named by a test. Evidence records the relevant transitive dependency
fingerprints. A change to a shared standard, context contract, template,
integration mapping, host adapter, evaluator, or external schema invalidates
the claims whose behavior may change.

The graph also limits invalidation: changing an unrelated pack does not make
all evidence stale. Every dependency edge states whether and how it affects
behavior, verification, or packaging so core can calculate the smallest honest
impact set.

Mutable external authorities define how freshness is established. Depending on
the contract, this may use a schema fingerprint, revision identifier,
conditional request, event, or bounded freshness interval. If freshness cannot
be established, the result is unknown or stale rather than assumed current.

### Scenario evaluation

Scenario evaluations originate from system promises and observed divergences.
A representative evaluation set includes:

- Expected successful behavior.
- Exclusions and cases another system should handle.
- Realistic pressure, ambiguity, and incomplete inputs.
- Integration failures, denied effects, retries, and recovery.
- Context conflicts, missing authorities, and stale dependencies.
- Rehydration after compaction, restart, or handoff where applicable.

Agent behavior is stochastic, so behavior claims use enough independent trials
to support their threshold. The evidence preserves each outcome and the
distribution; a single favorable transcript cannot stand in for repeated
behavior.

Evaluators consume structured artifacts and explicit rubrics. Judgment-based
evaluation is permitted where deterministic assertions cannot express quality,
but the evaluator, rubric, and rationale are versioned and reviewable. The
agent under test does not establish its own success merely by saying it is
done.

An improvement candidate reproduces its observed divergence before claiming a
fix. A new system that has no prior failure still proves its promised behavior
through representative scenarios; it does not need an artificial historical
failure to justify its existence.

### External and live verification

Live checks use the least effectful environment that can establish the claim:

1. Fixture or simulated provider behavior.
2. Local emulator, sandbox, or provider test tenant.
3. Read-only verification against the configured authority.
4. Reversible write with explicit cleanup and verification.
5. Narrow live canary under a declared effect policy.

A live premise is recorded and verified before the test relies on it. Writes
use idempotency and containment, record every external identifier, and verify
cleanup or compensation. A test that cannot safely contain its effects remains
manual or unsupported until the user explicitly authorizes an appropriate
canary.

Live verification complements contract tests and scenario evaluations; it does
not replace them. Provider availability, mutable data, and authentication make
live checks unsuitable as the only regression signal.

### Health model

The assembly states defined earlier remain separate:

- **Valid** describes declarations and graph consistency.
- **Ready** describes resolved dependencies and the ability to start.
- **Verified** describes applicable test evidence.
- **Healthy** describes recent real outcome evidence.

Health is evaluated per system and promised outcome over a declared observation
window. It may consider successful outcomes, failed outcomes, retries,
unverified external effects, drift, policy violations, and evidence freshness.
A last successful run does not erase later failures, and a pack's published
maturity does not guarantee the health of one user's configuration.

The configuration view rolls these states up without hiding their causes. For
example, an automation may be valid and verified but degraded because its
selected integration is unreachable, or ready but unhealthy because recent
runs completed without producing the promised external result.

### Diagnostics and doctor operations

Every diagnostic is structured and contains:

- A stable code, severity, and affected claim or contract.
- The subject and path through the dependency graph.
- Expected and observed state.
- Supporting evidence or the reason evidence is absent.
- A safe remediation, documentation reference, or next verification step.

Soter provides doctor operations at increasing containment levels:

- **Offline doctor** validates local definitions, configuration, locks,
  projections, graph resolution, and deterministic fixtures.
- **Connected doctor** checks authentication, reachability, external authority
  freshness, and read-only provider behavior.
- **Canary doctor** performs only the pre-authorized contained effects required
  to establish live write or dispatch behavior.

The user chooses or authorizes the level. If connected or canary checks do not
run, the report names the unverified claims; it cannot collapse to an
unqualified green result. CLI, UI, and agent interfaces render the same
diagnostics and evidence identifiers from core.

A connected provider probe identifies the exact configuration lock, provider
implementation and version, observation window, secret-reference identifiers,
authorities, and capabilities checked. It contains no credential values or
provider response bodies. Core derives readiness from these observations; an
integration cannot set the configuration's final readiness state itself.
Missing, expired, malformed, ambiguous, or wrong-lock probes remain failed,
stale, or unknown as appropriate. Read-only reachability can establish start
readiness, but it cannot establish write behavior, full automation
verification, or recent end-to-end outcome health.

A durable probe that fails is not collapsed into “missing.” Core can derive a
`provider-probe-attempt/v1` summary from the exact failed checkpoint. The
summary binds the lock, host, provider, declared probe scope, failed semantic
step, native route, failure category, checkpoint fingerprint, and a short
observation window. It excludes provider arguments, raw responses, credential
values, and the provider error message. A current failed attempt makes probe
completion fail and narrows only the readiness components justified by its
typed category—for example authentication, authorization, or route
unavailability. An expired attempt becomes stale; it is never durable proof
that a provider remains unhealthy. A mismatched or ambiguous attempt cannot
substitute for a completed probe.

An MCP server appearing in a host adapter is only a declared delivery route.
OAuth completion, current tool discovery, authority access, capability
translation, and provider health remain unknown until a connected probe for the
exact lock and provider establishes them. Repository configuration never stores
the OAuth credential itself.

### Gates and continuous verification

Verification gates attach to the action they protect:

- Configuration realization requires valid resolution and applicable
  migrations.
- Starting an automation requires readiness for its required contracts.
- Distributing a pack requires its declared release and conformance evidence.
- Promoting an improvement requires its regression and trial evidence.
- Granting greater autonomy requires effect-specific reliability and recovery
  evidence.
- Applying an upgrade requires a reviewed diff, successful migration checks,
  and a rollback plan where reversal is possible.

Local development and continuous integration run deterministic checks,
contract tests, fixtures, and contained agent scenarios appropriate to the
change. Connected checks, canaries, and runtime monitoring may run separately
because they require credentials, mutable authorities, or explicit effects.
Their absence is visible in the combined evidence view.

Verification mechanisms are themselves tested. Kernel validators require
contract tests and adversarial self-tests demonstrating that planted failures
are detected. A validator's own successful exit is evidence for one claim, not
proof of every behavior it is meant to protect.

### Monitoring and privacy

Runtime monitoring records structured events against the run envelope and
promised outcome. It captures enough information to diagnose failures and
support improvement without treating full prompts, source records, or secrets
as default telemetry.

Evidence remains local unless the user chooses to share it. Export and
contribution flows minimize and redact data according to the affected context
and integration contracts. Health calculations can use private evidence
without publishing the underlying records. If privacy constraints prevent a
claim from being externally reproduced, the shared result states that
limitation instead of overstating confidence.
