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
- configurations contains explicit desired configurations.
- hosts contains explicit adapter declarations and projection ownership.
- scenarios contains behavior-level fixtures and expected evidence.
- migrations maps prototype artifacts to their target ownership and state.
- kernel contains the target verifier shared by every future host projection.
- core contains provider-neutral resolution, preflight, evidence, offline and
  connected doctor operations plus a resumable host-tool request/result bridge
  consumed by future agent, CLI, and graphical interfaces.
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
dispatch with synthetic host results. Host MCP routes are declared for Notion
and Otter, but no connected provider translator or probe producer exists yet,
so the checked-in connected doctor reports `ready=failed`. This increment does
not authenticate or call an external provider, prove host-level agent judgment,
or replace the existing processing-a-meeting guide.

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
    node soter/core/cli.mjs fixtures --check
    node soter/core/cli.mjs doctor --lock soter/fixtures/meeting-intake/meeting-intake.lock.json

Inspect the expected missing-connected-provider diagnostics:

    node soter/core/cli.mjs doctor --lock soter/fixtures/meeting-intake/meeting-intake.lock.json --level connected

With only fixture providers declared, this exits nonzero by design. Connected
adapters pass one or more exact-lock `--probe PATH` artifacts; Core never
accepts a fixture result as connected state.

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
