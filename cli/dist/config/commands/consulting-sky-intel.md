---
description: "Answers questions about current Sky/Laniakea ecosystem state — deployment and build status, spell schedule and casts, governance outcomes, star metrics, Laniakea rollout progress — by consulting the org's live intelligence sources (the Laniakea tracker's status snapshot, the Sky Intelligence Briefs, the structured data feeds) and citing them, never from model recall. Use when a task needs a current Sky ecosystem fact or a Sky/Laniakea status summary. Not for defining ecosystem vocabulary (the LEXICON owns terms), capturing records (/capturing-a-task et al.), pushing or updating Notion pages (/pushing-to-notion, /updating-a-notion-page), or ingesting whole repos (/reviewing-a-repo)."
---

# Consulting Sky intel

## Goal
A Sky/Laniakea question answered from the org's live intelligence sources, every claim
carrying a link to the source consulted — zero facts stated from model recall.

## Use when / don't use when
- Use when: a task needs current Sky ecosystem facts — Laniakea build state, spell
  schedule or cast status, governance poll outcomes, star metrics, rollout progress,
  or a "what's happening in Sky" summary.
- Not for: defining or explaining ecosystem terms (the LEXICON is the vocabulary
  home — reference it, never redefine); capturing records (`/capturing-a-task`,
  `/capturing-an-org`); writing to Notion (`/pushing-to-notion`,
  `/updating-a-notion-page`); ingesting a repo into Notion (`/reviewing-a-repo`).

## The source map

The org runs a live intelligence apparatus outside the harness. Consult by question
class — each source is the authority for its column, and fresher beats broader:

| Question class | Authority | Where |
|---|---|---|
| Laniakea build state (releases, audits, key PRs, onchain counters) | the tracker's machine-generated status snapshot | `state/laniakea-status.json` in `soterlabs/wolfsclaw-laniakea-tracker` (fetch via `gh api` or raw URL) |
| Today's raw Laniakea signals | the tracker's daily Notion page | Laniakea Updates DB `c6ba7dac-7df9-4ed6-be1e-fee22d18fe2b` |
| Synthesized current intelligence (ecosystem-wide) | the newest Sky Intelligence Brief | Sky Intelligence Briefs DB `52c598a6989d4431b5ee604c17f78457` |
| Spell plan vs what actually cast | plan + publicly verified observations | `briefs/data/spells.json` (plan) and `briefs/data/spell-observations.json` (cast facts) in `soterlabs/wolfs-sky-intel-and-briefs` |
| Market/protocol metrics, per-star readings | the metrics feed | `briefs/data/metrics-latest.json` · `stars-latest.json` (same repo) |
| Governance poll tallies | the polls archive | `briefs/data/governance-polls.json` (same repo) |
| Cross-repo dev activity | the dev rollup | `briefs/data/dev-activity.json` (same repo) |
| Chainlog keys/addresses and their change history | the chainlog registry feed | `briefs/data/chainlog-registry.json` (same repo) |
| Weekly/monthly narrative | the published editions | Laniakea Weekly parent `33bd79b5-de38-8074-ae6f-f63f1ceb8cb8` · `published/` in the intel repo |

## Steps
1. **Classify the question** against the source map. One question may span rows —
   list which sources you will consult before fetching. FLEX: source depth (one
   authority may suffice for a narrow question; a status summary consults several) —
   but never zero sources.
2. **Fetch the authority.** GitHub-hosted feeds via `gh api` or the raw URL; Notion
   sources via the Notion tools. If a fetch fails, say so and answer only what the
   reachable sources support — a gap is declared, never filled from recall.
3. **Prefer machine ground truth over dated prose.** Where a status snapshot or feed
   disagrees with an older research doc or your own recall, the snapshot wins. Dated
   context docs inside those repos mark their own supersessions — honor them.
4. **Answer with citations.** Every factual claim links its source (the file, the
   Notion page, or the public API record). Vocabulary comes from the LEXICON —
   reference terms, never redefine them.
5. Verify: every stated fact traces to a fetched source in this session; no version,
   date, audit fact, or deployment status appears without one.

## Gotchas
- **Recall reproduces stale classifications.** Observed: the harness's own registry
  shipped Laniakea classified as a star; it is core ecosystem infrastructure. Any
  answer assembled from memory instead of the live sources risks exactly this class
  of error — which is why this guide exists.
- **Old expansions linger.** Observed in the tracker's own history: "Prime Allocation
  Unit" circulated before the canonical "Parallelized Allocation Unit" — when a term's
  expansion matters, take it from the LEXICON, not from an older document you fetched.
- **Audit findings are summarized by count with a report link, never itemized by
  finding number** — the intel repos' own writing standard; carry it into any output
  built on their data.
- **The status snapshot is machine-generated and append-owned by its bots** — read it,
  never edit it, and never treat a hand-written doc as fresher than it.

## Evals
- `.claude/evals/consulting-sky-intel/happy-path.md`
- `.claude/evals/consulting-sky-intel/pressure-recall.md`
- `.claude/evals/consulting-sky-intel/invariant-vocabulary.md`
