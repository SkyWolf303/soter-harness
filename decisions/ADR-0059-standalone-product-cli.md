# ADR-0059: A standalone product CLI — the harness gains a second chassis

- **Status:** Proposed
- **Date:** 2026-07-16

## Context

The harness ships only as a Claude Code plugin — real enforcement machinery welded
to one vendor's hook protocol. ADR-0004's quarantine confines that coupling to the
checker's argv dispatcher and the `system: platform` pieces; the check/guard/gate
functions themselves are protocol-neutral. OpenCode, an open-source multi-provider
agent chassis, offers a runtime that lacks exactly this repo's enforcement layer.

## Decision

Ship **Soter** (`@soterlabs/soter`) as a distribution of OpenCode, behind a written
**enforcement contract** — E1 pre-execution guard (guard-bash + guard-write), E2
post-write check, E3 session context injection, E4 turn gate — with the checker's
neutral core as its single implementation. Product code lives in `cli/`, a declared
exception to the no-new-scripts rule. Claude Code stays a supported chassis, unchanged.

## Consequences

Two chassis must stay honest against one contract: every enforcement behavior gets
stated in the contract, not implied by Claude Code's exit-2 convention, and the
selftest becomes the conformance bar both adapters run against. The `cli/` exception
is scoped — it sits at the root (workshop, outside `.claude/`), holds chassis
adaptation and packaging only, and enforcement rules still extend the one shared
checker, never per-rule scripts. Depending on OpenCode imports an upstream's release
cadence and API churn as a standing cost. Revisit when: the two adapters' behavior
diverges on a contract clause (tighten the contract or drop a chassis), or upstream
OpenCode changes make the distribution model dearer than owning a thin runtime.
