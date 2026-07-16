# Soter architecture

This document defines the intended architecture of Soter. It describes the
contracts the implementation must satisfy without making Claude, Codex, or any
external service part of the architecture itself.

## Purpose and design principles

Soter is a user-owned harness for assembling durable context, reliable
automations, and external integrations around capable agent hosts. It exists so
useful behavior can accumulate across sessions and users without becoming an
unexplained pile of prompts, provider-specific routines, and stale assumptions.

The harness should help a user:

- Understand which systems are present, why they exist, and what they can do.
- Select or remove capabilities without guessing about hidden dependencies.
- Give automations the right context and connect them to interchangeable
  integrations through explicit contracts.
- Use the same harness through Codex, Claude, and future compatible hosts.
- Know whether a system is configured, tested, working, degraded, or unknown.
- Turn observed failures and successful patterns into contained improvements.
- Share packs and configurations without unintentionally sharing private data,
  credentials, or runtime state.
- Let proven, bounded behavior become more autonomous without granting blanket
  authority to an agent.

Soter is successful when a new user or agent can inspect the configured harness
and continue its operation or development without needing the original author's
conversation history. The answer to “why is this here?” should live in the
system contract; the answer to “is it working?” should point to current
evidence.

### What Soter is not

Soter is not a model, a replacement for an agent host, or a synonym for the
model's context window. It is not a database that must copy every source of
truth, and it is not a workflow engine that requires every step to be
deterministic. It does not make external providers interchangeable where their
semantics genuinely differ.

Soter also does not define learning as unrestricted self-modification. It may
adapt within a run, improve a user's private configuration, and evolve shared
packs, but each scope has its own authority, evidence, and promotion boundary.

### Design principles

1. **Make the graph explicit.** Systems declare their dependencies,
   capabilities, authorities, effects, and evidence. Folder placement and
   conversational memory cannot be the only link between important behavior.
2. **Keep one canonical authority per fact.** A source may live in the harness
   or externally. Its role, freshness, edit path, and projection behavior are
   declared rather than inferred from location.
3. **Separate responsibility from delivery.** The five layers describe what a
   system owns. Packs describe how systems are selected and shared. Host
   adapters describe how the same contracts are delivered through an agent
   runtime.
4. **Keep outcomes separate from providers.** Automations express intended
   outcomes and required capabilities. Integrations implement those
   capabilities and expose provider-specific constraints honestly.
5. **Make configuration user-owned.** Required base systems are visible;
   optional systems never activate invisibly. Recommendations explain their
   reasoning and expand into inspectable configuration.
6. **Prefer contracts to repeated prose.** Instructions remain useful where
   judgment is required, but identity, compatibility, effects, authority,
   configuration, and verification are machine-readable when possible.
7. **Use deterministic enforcement for deterministic rules.** Agents should
   not spend judgment remembering constraints that a resolver, schema, effect
   gate, or checker can enforce reliably.
8. **Treat evidence as scoped and perishable.** A pass applies to declared
   claims, dependencies, environments, and freshness boundaries. Unknown,
   stale, and skipped evidence remain visible.
9. **Earn autonomy by change class.** Authority expands through demonstrated
   reliability, containment, monitoring, and rollback. It is revocable and
   never inferred from confidence alone.
10. **Improve by consolidation.** Observations do not write directly to shared
    behavior. Prefer correcting, simplifying, or retiring existing artifacts
    before creating another rule or exception.
11. **Design interfaces as projections.** Agents, CLI commands, graphical
    interfaces, and generated host files consume the same structured core
    model; none implements a competing version of the truth.
12. **Migrate through working vertical slices.** Preserve useful behavior,
    replace one boundary at a time, compare outcomes, and retire compatibility
    bridges when their evidence supports removal.

### Architectural promise

For every configured behavior, Soter should be able to answer:

- What system owns it?
- Which layer is responsible for it?
- Why was it selected?
- Which context and authorities does it rely on?
- Which automation produces the outcome?
- Which integration capabilities can create effects?
- Which host realizes the behavior?
- What may be changed, by whom, and under which policy?
- Which evidence shows that it works?
- What becomes stale or unavailable when a dependency changes?

If those questions cannot be answered from current contracts and evidence,
Soter reports the gap instead of asking the user to trust hidden machinery.

## Conceptual model

Soter is both a provider-neutral architecture and a reference implementation
of that architecture. The model defines what must remain consistent; the
implementation proves that the model can work on real agent hosts and external
services.

### The five layers

Layers classify responsibility and provide a simple order for assembling and
understanding a harness. They are not a literal execution pipeline: a run may
read context more than once, call several integrations, or return to an
automation after an external result arrives.

| Layer | Responsibility | Belongs here | Does not belong here |
|---|---|---|---|
| **Kernel** | Govern how Soter is defined, validated, evaluated, changed, and packaged. | Contract schemas, graph checks, evaluation rules, lifecycle governance. | Domain knowledge, user routines, or vendor behavior. |
| **Core** | Provide the portable runtime capabilities required by every harness. | Context assembly, configuration resolution, capability binding, effect policy, evidence, and health. | User- or domain-specific rules or provider-specific implementations. |
| **Context** | Define the world the harness works with and where its truth comes from. | Concepts, policies, schemas, relationships, authority declarations, and retrieval rules. | Orchestration, triggers, or vendor API choreography. |
| **Automation** | Turn context into a defined outcome or repeatable routine. | Triggers, inputs, steps, decisions, outputs, recovery behavior, and required capabilities. | Credentials, provider-specific calls, or hidden domain definitions. |
| **Integration** | Fulfill capabilities through local tools and external services. | Authentication requirements, provider adapters, data translation, typed errors, and capability implementations. | Business outcomes or automation-specific policy. |

Kernel and core are the required base. Each contains multiple required systems
rather than acting as one oversized system. Context, automation, and
integration systems are selectable: a user installs only the capabilities they
want, subject to declared dependencies.

### Context versus runtime context

The context layer does not mean whatever text happens to be in an agent's
context window. It defines durable meaning and authority: what a contact is,
which policy governs a process, which schema describes a record, and where the
canonical value can be found.

Core assembles a bounded runtime view from those declarations for a particular
request. That view may include local files, retrieved external records, user
input, and generated intermediate evidence. Runtime context is temporary;
context contracts and their authority declarations are durable.

### Systems, packs, artifacts, and bundles

- A **system** or **pack** is one coherent, selectable capability classified in
  one layer. “System” describes its architectural role; “pack” emphasizes that
  it can be installed, removed, versioned, and shared.
- An **artifact** is a component owned by a system, such as a contract, guide,
  policy, template, evaluator, or adapter implementation. Artifacts are not
  installed independently unless they are promoted into systems of their own.
- A **bundle** is a named collection of compatible packs. A bundle recommends a
  useful configuration and explains why each pack is included; it does not
  create another architectural unit.
- A **configuration** records the exact packs a user selected, their settings,
  integration bindings, trusted authorities, and portable sources. A source
  binds one capability input and authority to explicit consuming packs and
  purposes; it does not make the Integration aware of consumer-specific
  settings. Packs declare required source purposes and cardinality in their
  manifests. Configuration must be portable, inspectable, and shareable without
  silently activating optional systems or resolving with a missing concrete
  source.

A provider integration may implement several capability contracts, and a user
may install several integrations at once. Configuration binds an automation's
required capability to the chosen implementation and authority.

### Agent hosts

Codex, Claude, and future agent runtimes are **hosts**, not layers. A host
adapter projects Soter into that host's native instruction, skill, tool,
plugin, hook, approval, and scheduling mechanisms. Host-specific files are
delivery artifacts; they must not redefine Soter's contracts or semantics.

Supporting a host therefore means passing a conformance suite, not merely
copying files into a recognized folder. The same configured harness should
preserve its declared meaning, effects, gates, and evidence even when the host
uses different native mechanisms.

### Vocabulary discipline

Soter introduces a term only when it names a distinction that matters to users
or can be enforced mechanically. Existing terms such as mechanism, component,
and engine are retained only where they express a necessary distinction; they
are not foundational merely because the current harness uses them. One concept
must have one canonical term, and retired synonyms must not remain as competing
instructions.

## Operating architecture

The conceptual model above is implemented through a connected set of contracts.
[CONTRACTS.md](./CONTRACTS.md) is the normative specification for system
manifests, graph resolution, runtime behavior, configuration, hosts,
integrations, interfaces, evidence, and health.

### Connections and health

Every pack declares its purpose, requirements, provided interfaces, authorities,
effects, configuration, verification, compatibility, and maturity. Core
resolves those declarations into one graph before a configured behavior runs.
Required connections fail closed; missing optional connections remain visibly
degraded.

Soter reports four separate assembly states:

- **Valid:** declarations and graph relationships are internally consistent.
- **Ready:** required packs, authorities, capabilities, permissions, and
  policies are resolved for the active configuration.
- **Verified:** applicable checks and evaluations have current passing evidence.
- **Healthy:** recent runtime evidence shows the configured systems achieving
  their promised outcomes within policy.

These states and their causes come from one structured source used by agents,
CLI commands, graphical interfaces, and generated host projections.

### Runtime and learning

One runtime supports inspect, operate, configure, and develop intents. A run
resolves the user configuration, assembles authority-aware context, establishes
effects, executes an automation through integration capabilities, verifies its
promised outcome, and records a durable run envelope and evidence.

Learning has three scopes: temporary adaptation within a run, private
user-configuration improvement, and shared pack evolution. An operational run
may create an improvement candidate, but durable pack changes occur in a
separate development run with explicit authority, evaluation, trial, promotion,
monitoring, and rollback. Autonomy is granted per effect or change class and is
earned through evidence rather than agent confidence.

### Configuration and distribution

The user owns an explicit desired configuration. Core resolves it to an exact
lock while keeping runtime state and secrets separate. The lock fingerprints
selected manifests, every declared pack artifact, capability contracts,
authority declarations, portable source inputs and consumers, and
behavior-relevant host projections. Kernel and the
minimum core are required; context, automation, integration, and optional core
packs are selectable subject to declared dependencies.

Bundles are transparent recommendations that expand into ordinary
configurations. Packs and configurations can be shared without silently
sharing credentials, private runtime state, or optional evidence. Upgrades
preview contract, permission, migration, projection, and verification changes
and preserve a rollback path where the effects allow one.

### Hosts, integrations, and interfaces

Codex, Claude, and future agent runtimes are hosts. Tested host adapters project
the same resolved Soter configuration into each host's native guidance, skills,
plugins, hooks, approvals, tools, and scheduling features. Host files are
delivery projections, not independent authorities.

Automations depend on stable capability contracts. Integration packs implement
those capabilities for providers such as Notion, Gmail, Slack, or Otter and own
authentication, transport, translation, typed errors, retry behavior, and
provider limitations. MCP is a supported transport, not the architecture.

For an MCP-backed integration, Core and the host cooperate through a resumable
boundary:

1. Core resolves the exact capability, provider, authority, effects, and host.
2. The integration translator converts the portable input into one
   provider-neutral operation and argument object for an allowlisted logical
   MCP server.
3. Core validates policy and input before emitting that request. A blocked
   effect produces no provider arguments and no tool execution.
4. Core resolves the operation through the exact selected host adapter to one
   native tool name. The host invokes only that resolved tool through its
   current connector, plugin, or project MCP configuration and performs
   authentication and native approval handling.
5. The host returns the result to Core. The integration translator normalizes
   it into the portable capability output, and Core validates the output and
   records only the response and output fingerprints needed for traceability.

Readiness checks use a parallel but distinct resumable probe state machine.
Core fixes the credential-reference, authority, and capability scope from the
resolved configuration. It also projects only sources explicitly marked
`probe-read`, omitting their consumer wiring, so the integration receives exact
portable inputs without learning an Automation's settings shape. The integration
chooses from a narrower safe probe-tool allowlist and returns observations rather
than a readiness verdict.
A single safe request can use the legacy call contract. When readiness requires
several resources or methods, a private probe-plan checkpoint exposes one exact
host request at a time, fingerprints its semantic scope and arguments, and
requires checkpoint plus call identity on resume. Core rederives the complete
plan before accepting each response, stores only minimized step observations,
and assembles the exact-lock, expiring probe after every required step passes.
An identity result can therefore prove authentication and reachability without
being mistaken for transcript or record compatibility, and an integration
cannot hide several host calls behind one translator invocation.

This keeps provider credentials and raw host transport outside Core while
preventing Codex- or Claude-qualified tool names from becoming automation API.
The durable call records both the portable operation and resolved native tool,
so a resume cannot silently reinterpret either side of the mapping. Host
configuration proves only that a route is declared. Connected probes and
behavior evidence are still required to claim readiness or verification.

Core exposes one versioned structured model to agent tools, CLI commands,
graphical interfaces, and automation triggers. Business rules, graph
resolution, effect policy, and health calculations live in core so interfaces
cannot drift.

The current reference projection realizes that rule with one Core service and
two thin interfaces: structured CLI commands and a local stdio MCP server. The
MCP server is not an integration provider and does not proxy credentials or
provider traffic. It lets a host prepare an exact logical request, execute that
request through its separately configured provider tool, and return the native
result for exact-lock validation and normalization. Codex and Claude configure
the same server rather than reimplementing policy or translation. Each launch
binds the server to its active host identity, so a Claude projection cannot
consume a lock resolved for Codex or vice versa. A later UI must call this same
service boundary as well.

This projection deliberately exposes no generic way to attach connected-write
approval. Reads and probes can cross the seam when their resolved policy allows
them. A trusted CLI path may compile and approve an exact connected operation
batch, then start a private transaction checkpoint bound to that approval,
change set, run, lock, and graph. The MCP projection can recover and advance
that existing checkpoint by exact checkpoint and call IDs, but it cannot
originate, replace, or widen approval.

Before returning a requested call, the current MCP projection atomically writes
a private, self-fingerprinted checkpoint and updates a private durable copy of
the run envelope under `.soter/state`. A restarted host can list pending calls,
rehydrate one by checkpoint ID, and complete or fail it without reconstructing
the request from conversational memory. Completion stores the normalized
result in private state, records only fingerprints in the run envelope, and
never persists the native provider response. One outstanding capability, plan,
or transaction call per run prevents ambiguous concurrent resume. Connected
update transactions expose explicit compare, write, and verify calls. If a
later operation conflicts, Core restores verified earlier updates in reverse
order and verifies each restoration. An unknown write outcome is not
represented as rollback: the checkpoint enters `needs-attention` for
reconciliation because external systems do not provide an ACID transaction
boundary. Reconciliation emits only an exact record read. Approved state can
resume the batch, prior state can close or continue rollback, and missing,
divergent, failed-read, or unproven compensation state remains paused. It never
replays the ambiguous write.

The stdio self-test terminates and restarts the server between preparation and
completion, repairs planted partial cross-file updates, rejects stale and
tampered state, and proves response minimization. This establishes local Core
recovery behavior, not that Codex or Claude actually selected and executed the
provider tool in a real task.

### Verification

Verification progresses from static and graph validation through fixtures,
agent scenario trials, contained integration checks, live canaries, and runtime
monitoring. Every claim points to evidence tied to the exact relevant
configuration, host, integration, authority, evaluator, and transitive
dependency fingerprints.

Passed, failed, stale, unknown, skipped, and not-applicable results remain
distinct. Dependency changes invalidate only the affected evidence. Doctor
operations provide offline, connected, and canary levels without representing
checks that did not run as green.

## Evolution from the current harness

The existing repository is a useful working prototype and a source of observed
behavior. It is not required to be the final directory structure, vocabulary,
package format, or runtime. Soter evolves it through contained vertical slices
rather than discarding working mechanisms or pretending the target architecture
already exists.

### Starting-point assessment

The repository already demonstrates several strong foundations:

- Systems and artifacts carry explicit classification metadata.
- Molds, standards, and a shared checker make important shape and safety rules
  mechanical.
- Checker self-tests plant failures and prove that diagnostics fire.
- Human-gated changes, isolated worktrees, and scoped staging reduce unsafe
  concurrent edits.
- External writes use deliberate confirmation and fetch-merge-write discipline.
- Live schemas are treated as authorities rather than inferred from one example.
- Observed failures can become evaluations and durable corrections.

Those mechanisms remain evidence for the target architecture. They are retained
until a replacement proves the same or stronger contract.

The repository also exposes the gaps this architecture is meant to close:

| Area | Starting point | Required evolution |
|---|---|---|
| **Layers** | Kernel, core, context, and automation classify artifacts, while provider behavior is mixed into guides and configuration. | Add the integration layer and enforce its boundary through capability contracts. |
| **Kernel** | Strong design-time governance and one checker. | Govern system contracts, graph resolution, evidence, packaging, and migrations without becoming the operational runtime. |
| **Core** | A small policy capability rather than a complete runtime foundation. | Add configuration resolution, context assembly, effect policy, run envelopes, evidence, health, and interface services. |
| **Context** | Useful domain systems and external authority knowledge exist, but authority and editing behavior are often encoded in prose. | Declare context, authority roles, freshness, and change contracts mechanically. |
| **Automation** | Guides orchestrate useful real work, often with direct provider details and mutable template assumptions. | Separate outcomes and capability requirements from provider choreography. |
| **Integration** | MCP servers, plugins, targets, and service-specific instructions are implicit implementation dependencies. | Promote providers into selectable integration packs with typed capabilities, effects, errors, and health. |
| **Hosts** | Claude project and plugin structures are the effective delivery model. | Make provider-neutral definitions canonical and realize them through tested Claude and Codex adapters. |
| **Evaluation** | Static checks are strong; scenario cases and golden freshness are mostly manual and direct-dependency based. | Add executable scenarios, multiple trials, durable evidence, and transitive invalidation. |
| **Configuration** | Installed behavior is inferred from repository contents and host-specific files. | Add explicit desired configuration, resolution, locks, bindings, and generated projections. |
| **Distribution** | A Claude-oriented plugin and marketplace attempt exist, but the generic base and private user-specific behavior are not truly separated. | Distribute versioned packs, bundles, and shareable user configurations through a host-neutral contract. |

“Built” or “sealed” is not an architectural status. Existing systems may be
useful and green under current checks while still lacking target contracts,
portable delivery, executable evidence, or recent health.

### Migration principles

Migration follows these rules:

- **Keep working behavior available.** A current automation remains usable until
  its replacement passes equivalent outcome and effect verification.
- **One authority at a time.** Every migrated definition declares whether the
  legacy file or the new provider-neutral source is canonical. Two writable
  authorities are never left to drift.
- **Bridge explicitly.** Compatibility readers, generated projections, aliases,
  and temporary mappings have owners, diagnostics, and retirement criteria.
- **Migrate vertical behavior.** Move one useful outcome through context,
  automation, integration, host realization, evidence, and health instead of
  reorganizing every file by layer first.
- **Compare before switching.** Use fixtures, shadow runs, or contained canaries
  to compare old and new behavior where the effects allow it.
- **Preserve rollback.** Record the prior lock, authority mapping, generated
  projection, and external migration consequences before switching.
- **Remove proven redundancy.** After a bridge's dependents migrate and its
  retirement checks pass, delete the duplicate path rather than preserving it
  indefinitely for comfort.

The current `.claude/` tree may remain a temporary source while contracts are
mapped. Once a provider-neutral definition becomes canonical, Claude files
become generated or adapter-owned projections. Codex projections are generated
from the same resolved lock. A mass directory move before that boundary exists
would change paths without fixing the architecture.

### Migration manifest

A machine-readable migration manifest tracks each existing system and artifact
through these states:

- **Current:** still authoritative for the working harness.
- **Mapped:** assigned a target system, layer, contract, and authority without
  changing runtime behavior.
- **Bridged:** usable through both legacy delivery and the new runtime, with one
  declared canonical source.
- **Migrated:** realized from the target contracts with applicable evidence and
  health reporting.
- **Retired:** no configured behavior depends on the legacy artifact or bridge.

Each entry identifies the old location, target identifier, authority status,
dependents, compatibility bridge, verification claims, rollback path, and
retirement criteria. The manifest replaces memory and historical narrative as
the answer to “has this piece migrated?”

### Delivery sequence

The implementation sequence is:

1. **Accept the architecture and preserve a baseline.** Resolve known written
   contradictions, record current behavior and checks, and stop describing the
   kernel as complete or sealed.
2. **Introduce the minimum contract substrate.** Define stable identifiers,
   system manifests, dependency and capability edges, authority roles, effect
   declarations, configuration schema, and the migration manifest. Map current
   artifacts before moving them.
3. **Prove one end-to-end vertical slice.** Select a current automation that
   exercises context, at least two integrations, an external effect, a human or
   policy gate, and outcome verification. Meeting intake is the selected first
   slice; its declared pack graph and migration mapping live under
   [soter/](./soter/). Its contained Core context path is now implemented
   through typed fixture providers without claiming automation execution or
   connected provider readiness.
4. **Build the minimum core runtime around that slice.** Resolve its
   configuration, assemble its run envelope and context, bind capabilities,
   apply effect policy, record evidence, and report health.
5. **Separate provider integrations.** Extract provider choreography from the
   automation into capability contracts and integration packs while retaining a
   compatibility binding for the current workflow.
6. **Realize both initial hosts.** Treat the working Claude behavior as a
   reference, then prove equivalent declared behavior through a Codex adapter.
   Test each from an otherwise empty consumer configuration.
7. **Make verification executable.** Add contract fixtures, headless scenario
   trials, transitive invalidation, connected smoke checks, doctor operations,
   and CI evidence for the vertical slice.
8. **Add user configuration and distribution flows.** Support explainable pack
   selection, bundles, locks, install and upgrade previews, shareable templates,
   and one distributable clean-install path.
9. **Expose the shared interfaces.** Build CLI and graphical experiences over
   the same core model, beginning with configuration, graph, run, evidence, and
   health views.
10. **Migrate remaining systems incrementally.** Prioritize frequently used or
    drift-prone systems, retire bridges after proof, and use observations to
    improve the contracts and tools.

The sequence establishes structured APIs for UI and distribution early, but
does not wait for a polished interface or public registry before proving the
runtime and contract boundaries.

The current checkpoint has completed the contract substrate and the declared
meeting-intake graph. Step 4 is partially implemented through deterministic
resolution, artifact-fingerprinted locks, effect-free preflight, typed fixture
capability dispatch, authority-aware context snapshots, exact-scope approvals,
transactional fixture writes, rollback proof, read-after-write verification,
claim-scoped evidence, an offline doctor, contract-enforced aggregation of
short-lived connected provider probes, explicit sequential provider-probe plans,
typed expiring summaries for exact failed provider-probe attempts,
and private durable checkpoints for host-dispatched calls and their run
envelopes. Core now also has versioned
sequential operation-plan contracts: v1 retains fixed inputs, while v2 binds
typed string-list references from earlier normalized outputs into later inputs.
The private checkpoint emits one exact policy-bound call at a time, fingerprints
each resolution, skips empty reference chains without a provider request,
requires both checkpoint and current-call identity on resume, and recovers the
next step after restart without retaining native provider responses.
Meeting-intake Automation uses that same Core service to prepare a bounded
connected grounding plan: policy index, every policy page explicitly wired to
the Automation as an `applicable-policy` portable source, exact transcript,
exactly one CRM meeting matched by recording URI, and only the organizations,
projects, and tasks referenced through that meeting. The index and page reads
must agree on each configured policy's exact URI and title. Automation records the governed
subjects and applicability reason for every bounded body, validates domain
completeness, and rejects a related read that omits or adds an ID; Core binds
every snapshot entry to an exact normalized plan output and passed effect,
persists the private snapshot, marks the definition authority loaded, updates
the same durable run, and pauses before writes. Policy prose is grounded context,
not executable rules: content interpretation and enforcement remain a host
judgment boundary. Participant People IDs are not treated as CRM contact page
URIs. The current target includes the
first connected Otter provider mapping, exact transcript-fetch request
translation, and identity-only probe producer. It also includes a connected
Notion provider whose bounded reads and gated mapped-write translators,
pack-owned settings, typed provider field mapping,
bounded one-target query translator, normalized record versions, and exact
per-host native tool mappings are mechanically checked. The one-target boundary
avoids depending on plan-gated cross-data-source SQL; multi-target reads can be
explicit ordered capability steps, and the initial connected context boundary
now exercises that orchestration without broad reads across every CRM target.
Notion readiness is a separate 18-step private plan: identity, schema and one-row
bounded read checks for all seven configured targets, then an exact identity- and
title-bound read for each of the three configured `probe-read` policy sources.
Schema checks bind every portable field to its current provider property name
and type; record and document checks discard row values and policy bodies before
persisting only minimized counts, booleans, and fingerprints. The completed
probe can establish exact-lock `crm.records.read` and `documents.content.read`
compatibility, but not policy interpretation. The checked mapping now names the
observed `🫂 Contacts` organization relation, but that development observation
is not reusable connected evidence: another exact lock must run its own expiring
probe. Otter's
identity-only probe deliberately leaves transcript compatibility unknown, and
all unobserved response shapes fail closed.
When a host cannot execute an exact probe route, Core preserves the private
failed checkpoint and exposes only a typed, expiring attempt summary to the
connected doctor. This distinguishes authentication, authorization, route
availability, and response-conformance failures from a probe that was never
attempted without persisting arguments, raw responses, or error messages. A
declared host tool mapping still does not establish that the active execution
bridge exposes the tool.
Connected readiness still fails because no current private probes are checked
in and Notion write permissions or response conformance are unproven. Notion
create and update translation is now declared only for explicitly mapped
fields. Core can compile a proposed change set into an exact connected
operation batch with deduplication or expected-version preconditions,
verification expectations, recovery modes, and a separate expiring approval
fingerprint. It rejects the current contained meeting-intake change set because
several write fields are absent from the connected mapping, and it blocks even
a mapped create because the current connector route cannot compensate a newly
created page. The compiler and preview CLI execute no provider calls; durable
mapped updates now use a private `connected-transaction-checkpoint/v1`. Core
validates the exact approval before the first write, captures compared prior
mapped fields, verifies each applied patch, compensates verified updates in
reverse after a later conflict, and recovers the exact current host call after
restart. It preflights every operation and recovery route before the first
effect so an invalid tail cannot strand earlier changes. The CLI alone
originates the authorized checkpoint; MCP only advances it or requests a
checkpoint-bound read-only reconciliation. Reconciliation histories classify
approved, prior, missing, divergent, and failed-read observations and resume
only when the normalized record proves a safe transition. Synthetic local
tests prove this Core state machine, not connected
credentials, provider write conformance, or a live end-to-end write. Observed Otter
transcript conformance, host-started end-to-end dispatch, policy interpretation
and enforcement, participant identity resolution, compensated creates, live
approval-bound provider writes, live health, host judgment, and host conformance remain
future proof boundaries. The v2 plan contract is intentionally narrower than a
general workflow language: arbitrary transforms, branching, parallelism,
fan-out, retries, and compensation are not implemented.

### Change unit and completion gate

Each migration change states:

- The user-visible behavior being preserved or intentionally changed.
- The current and target authorities.
- The affected graph and evidence invalidation set.
- The new or changed contracts and compatibility bridge.
- The verification ladder levels exercised.
- The rollout, monitoring, rollback, and retirement conditions.

A migration unit is complete only when the target behavior is valid, ready,
verified, and—where real use exists—has an explicit health state. Passing the
legacy checker alone does not complete a target migration, and creating a new
file without switching authority does not count as progress.

### Decision history

Existing ADRs remain a historical archive. They are not a runtime dependency,
a required README section, or mandatory ceremony for ordinary development.
The architecture, contracts, tests, migration manifest, and change history
should normally contain the rationale needed to continue the work.

A lightweight decision note is reserved for a rare cross-cutting choice that
changes a public contract, security or authority boundary, compatibility
promise, or expensive-to-reverse direction and whose rationale cannot live
clearly beside the affected architecture. Such notes explain constraints; they
do not substitute for executable contracts or evidence.

### Target migration proof

The migration has established the new foundation when a user can:

- Start from the required kernel and core and understand why each base system
  is present.
- Select, remove, and replace context, automation, and integration packs through
  an explicit configuration with a resolved lock.
- Inspect the full dependency, authority, capability, effect, and evidence
  graph without reading implementation history.
- Run a representative automation through both Claude and Codex with equivalent
  declared outcomes and honest capability-gap reporting.
- Replace one integration with another implementation of the same capability
  without rewriting the automation.
- Resume a run after compaction or restart from its envelope.
- Receive precise valid, ready, verified, healthy, degraded, stale, and unknown
  reporting through the same CLI and graphical data model.
- Install a shared pack or configuration into an otherwise empty consumer and
  reproduce its declared verification evidence.
- Observe a divergence, create a contained improvement candidate, evaluate it,
  promote it under policy, and roll it back if runtime evidence regresses.

Reaching this proof does not finish Soter. It establishes a sustainable base on
which new systems can be added without returning to guesswork.
