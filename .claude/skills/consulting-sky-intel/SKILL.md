---
name: consulting-sky-intel
description: >-
  Answers questions about current Sky/Laniakea ecosystem state — deployment and build
  status, spell schedule and casts, governance outcomes, star metrics, Laniakea rollout
  progress — by consulting the org's live intelligence sources (the Laniakea tracker's
  status snapshot, the Sky Intelligence Briefs, the structured data feeds) and citing
  them, never from model recall. Use when a task needs a current Sky ecosystem fact or
  a Sky/Laniakea status summary. Not for defining ecosystem vocabulary (the LEXICON
  owns terms), capturing records (/capturing-a-task et al.), pushing or updating Notion
  pages (/pushing-to-notion, /updating-a-notion-page), or ingesting whole repos
  (/reviewing-a-repo).
disable-model-invocation: true
layer: context
system: sky
kind: component
mold: how-to-guide
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

The org runs a live intelligence apparatus outside the harness. **This guide holds the
day-to-day question-class map**: consult by question class — each source is the
authority for its column, and fresher beats broader. The highest-traffic routes:

| Question class | Authority |
|---|---|
| Laniakea build state (releases, audits, key PRs, onchain counters) | the Laniakea tracker's machine-generated status snapshot |
| Synthesized current intelligence (ecosystem-wide) | the newest Sky Intelligence Brief |
| Spell plan vs what actually cast | the spell plan feed + the publicly verified spell-observations feed |
| Market/protocol metrics, per-star readings | the metrics and per-star feeds |

**Every other question class routes by the source registry's entries** — match the
question against the `Answers:` / `Preferred-feed:` lines in
`.claude/standards/sky-sources.md`. The registry is the per-source depth behind this
map: each entry carries the source's endpoints, auth, fetch technique, and operating
home. Precedence is one-directional and concrete: **source facts — endpoints, homes,
technique — always come from the registry entry**, including for the routes tabled
above. A question that doesn't route here or there gets a declared gap, never an
improvised source.

## Steps
1. **Classify the question** — first against the quick routes above; anything unrouted
   resolves by the entries' `Answers:` / `Preferred-feed:` lines in
   `.claude/standards/sky-sources.md`. One question may span rows — list
   which sources you will consult before fetching. FLEX: source depth (one authority
   may suffice for a narrow question; a status summary consults several) — but never
   zero sources.
2. **Fetch the authority** — endpoint, auth, and technique per its registry entry.
   GitHub-hosted feeds via `gh api` or the raw URL; Notion sources via the Notion
   tools. If a fetch fails, say so and answer only what the reachable sources
   support — a gap is declared, never filled from recall.
3. **Prefer machine ground truth over dated prose.** Where a status snapshot or feed
   disagrees with an older research doc or your own recall, the snapshot wins. Dated
   context docs inside those repos mark their own supersessions — honor them.
4. **Answer with citations.** Every factual claim links its source (the file, the
   Notion page, or the public API record). Vocabulary comes from the LEXICON —
   reference terms, never redefine them.
5. Verify: every stated fact traces to a fetched source in this session; no version,
   date, audit fact, or deployment status appears without one.

## Gotchas
- **Recall reproduces stale classifications.** Observed: the harness's term registry
  in the LEXICON shipped Laniakea classified as a star; it is core ecosystem
  infrastructure. Any answer assembled from memory instead of the live sources risks
  exactly this class of error — which is why this guide exists.
- **Old expansions linger.** Observed in the tracker's own history: "Prime Allocation
  Unit" circulated before the canonical "Parallelized Allocation Unit" — when a term's
  expansion matters, take it from the LEXICON, not from an older document you fetched.
- **Audit findings follow the registry's Fetch discipline rule** (summarize by count
  with a report link) — carry it into any output built on the intel repos' data.
- **The status snapshot is machine-generated and append-owned by its bots** — read it,
  never edit it, and never treat a hand-written doc as fresher than it.

## Evals
- `.claude/evals/consulting-sky-intel/happy-path.md`
- `.claude/evals/consulting-sky-intel/pressure-recall.md`
- `.claude/evals/consulting-sky-intel/invariant-vocabulary.md`
