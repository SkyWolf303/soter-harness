---
name: sky-sources
layer: context
system: sky
kind: component
mold: standard
---

# Sky sources

## The model

The org runs its Sky/Laniakea intelligence apparatus outside the harness, in two intel
repos. This registry is the harness's map of every source that apparatus consults —
what each answers, what it costs to fetch, and the technique it demands.
`/consulting-sky-intel` holds the day-to-day question-class map and steps; this
standard is the per-source depth behind it. The guide points, this registry describes —
neither copies live facts.

**Fetch discipline — governs every entry:**

1. **Cite every claim to the source fetched this session.** Zero facts from recall —
   no version, date, audit fact, or deployment status appears without a fetched link.
2. **Machine-generated feeds beat dated prose, and both beat recall.** Where a status
   snapshot or structured feed disagrees with an older research doc or memory, the
   feed wins. Dated docs mark their own supersessions — honor them.
3. **A failed fetch is a declared gap.** Answer only what reachable sources support;
   never fill from recall. Zero and unknown are different answers.
4. **Audit findings are summarized by count with a report link, never itemized by
   finding number** — the intel repos' own writing standard, carried into anything
   built on their data.

**Operating homes.** Every entry is marked with the home that runs its scheduled
collection — a collection runs in exactly one home (running it elsewhere doubles its
writes):

- **tracker** — `soterlabs/wolfsclaw-laniakea-tracker`: Python collectors on scheduled
  runs, plus its enrichment and weekly agents. Strictly Laniakea rollout scope (the
  in/out lists live in its CLAUDE.md).
- **intel** — `soterlabs/wolfs-sky-intel-and-briefs`: the ecosystem-wide structured
  feeds (`briefs/data/*`) and the Sky Intelligence Briefs.

**Pipeline order is the invariant, not the clock:** all scheduled scans complete
before the enrichment run, and enrichment completes before the weekly run — that
ordering (the clock times drift) is what makes the daily page and its enrichment
section safe to prefer.

**Alert outputs and their ownership split:** Telegram alerts (Bot API `sendMessage`)
are owned by the Python tracker — never run the tracker in a second home, which
doubles its Telegram/Notion writes. The daily Slack digest is owned solely by the
enrichment agent; the weekly agent writes to Notion only, never Slack. OVERDUE
launch-gate classifications also escalate to Slack. Env vars (names only):
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`, `SLACK_WEBHOOK_URL`, `SLACK_BOT_TOKEN`.

Where an entry names a **preferred feed**, consume the feed — never re-collect what it
already precomputes. Auth is stated as env var NAMES only, never values; Notion
database ids are not secrets.

### Forum

**Sky Forum (Discourse)** — home: tracker (`collectors/forum.py`); ecosystem-wide
sweeps land in the intel Briefs.
- Endpoint pattern: `https://forum.skyeco.com/search.json?q=<kw>`, per-section
  listings `/c/<slug>/<id>.json` (the extra swept sections live in the tracker's
  `config.py:FORUM_EXTRA_CATEGORIES`), topic detail `/t/<id>.json`. Per-section RSS
  exists via a `.rss` suffix (documented in the tracker's social inventory file).
- Auth: none (public).
- Answers: governance discussion, technical-scope posts, BA Labs parameter posts,
  community signals.
- Technique: sweep by keyword across ALL forum sections (Discourse's own term for them appears in constant names like `FORUM_EXTRA_CATEGORIES`) (`latest.json` plus
  `search.json?q=<kw> after:<date>`; the sweep keyword set lives in the tracker's
  `tasks/lessons.md` rule — `config.py` holds only the separate relevance-scoring
  keyword lists used by `relevance.py`) — never key on a single section id (observed:
  the pivotal technical-scope post sat in a different section than its launch gate
  specified, and both the tracker and the agent missed it). `search.json` relevance
  ranking is noisy — trust the keyword sweep, not the ordering. Read the full topic
  JSON and inspect ALL replies: contributor confirmations and parameter posts hide in
  replies and satisfy separate launch gates. State: seen topic ids (capped), recording
  non-relevant ids so they aren't rechecked; per-run URL dedup (search overlaps
  section listings).
- Preferred feed: the tracker's daily page in the Laniakea Updates DB
  `c6ba7dac-7df9-4ed6-be1e-fee22d18fe2b` already carries the scored forum signals.

### Governance

**Sky governance API** — home: tracker (`collectors/governance.py`).
- Endpoint: `https://vote.sky.money/api/executive` — public read-only JSON; the full
  REST surface is documented at its `/api-docs`.
- Auth: none.
- Answers: active polls and executive votes; spell status (pending, scheduled with
  eta, cast).
- Technique: diff executive `address`/`key` against known-keys state (capped);
  low-threshold keyword relevance on title + blurb; non-relevant keys are tracked but
  not alerted. Quirk: the legacy `vote.makerdao.com/api` predates the SKY token
  migration and is MKR-denominated — MKR and SKY are not 1:1, so historical series
  differ across the two APIs.
- Preferred feed: `briefs/data/governance-polls.json` (intel) for poll tallies.

**Launch gates** — home: tracker (`launch-gates.json` at the repo root).
- Endpoint: the file itself. Human-edited; agents treat it as READ-ONLY.
- Auth: none for the agents (a local file at the tracker repo root);
  `GITHUB_TOKEN` / `gh` CLI only when fetching it remotely from the harness.
- Answers: the gate calendar for the active deployment cycle and each gate's
  confirming signal (branch/PR, audits directory, chainlog keys, forum post, spell PR,
  executive API).
- Technique: gates classify daily as CONFIRMED / DUE SOON / OVERDUE / PENDING; OVERDUE
  classifications also escalate to Slack. The file carries an `internal_only` flag —
  flagged content is not citable until a public artifact exists. Never key a gate
  check on the literal location the gate names — sweep the confirming signal's whole
  domain (the forum lesson above).

**Spell plan vs casts** — home: intel.
- Endpoint: `briefs/data/spells.json` (plan) and `briefs/data/spell-observations.json`
  (publicly verified casts).
- Auth: `GITHUB_TOKEN` / `gh` CLI.
- Answers: which spells are planned versus actually cast.
- Technique: these ARE the precomputed feed — never reconstruct cast history from
  chain or forum yourself.

### Onchain

**Chainlog** — home: tracker (`collectors/onchain.py`).
- Endpoint: `https://chainlog.skyeco.com/api/mainnet/active.json` (one call, public).
- Auth: none.
- Answers: which Laniakea-relevant contract keys and addresses exist or changed.
- Technique: hash of the sorted JSON for cheap change detection; on change, diff only
  entries whose keys match the Laniakea prefixes
  (`config.py:LANIAKEA_CHAINLOG_PREFIXES`) against the snapshot state; report
  new/changed/removed.
- Preferred feed: `briefs/data/chainlog-registry.json` (intel) — keys, addresses, and
  their change history.

**Ethereum RPC — factory event watch** — home: tracker (`collectors/onchain.py`).
- Endpoint: JSON-RPC `eth_blockNumber` + `eth_getLogs` against
  `https://eth-mainnet.g.alchemy.com/v2/{key}`; fallback public node
  `https://ethereum-rpc.publicnode.com` when the key is unset (quirk: the fallback
  requires a User-Agent header).
- Auth: `ALCHEMY_API_KEY` (optional; read-only).
- Answers: PAU deployments the moment they happen — factory events are the earliest
  detection that exists, firing before any forum post or registry merge.
- Technique: watch the canonical factory addresses and the topic0-to-event-name map
  (`PAU_WATCH_ADDRESSES`, `PAU_EVENT_TOPICS` in config; the map was verified against
  observed on-chain hashes, never recall). `eth_getLogs` runs in block chunks with a
  per-run cap (`PAU_GETLOGS_CHUNK` and the cap live in config, sized for the free
  tier); the remainder carries to the next run, and on RPC failure state advances only
  to `scanned_to` — never past what was actually scanned. First activation starts from
  now, no backfill. Security: the RPC POST explicitly blanks the `Authorization`
  header so the client-level GitHub token never reaches the RPC provider. Semantics:
  cumulative event counts live in state; the first-ever `ALMProxyDeployed` /
  `RateLimitsDeployed` pair signals an independently deployed PAU stack (a topology
  tell), surfaced as `onchain.independent_stack_seen` in the status feed.
- Preferred feed: the on-chain counters in `state/laniakea-status.json` (tracker).

**Explorer APIs and the address book** — home: tracker
(`ON_CHAIN_DATA_SOURCES_INVENTORY.md`).
- The inventory file holds the full address book (the chainlog contract, core /
  governance / PSM / bridge / oracle addresses, the per-star SubProxy / StarGuard /
  Allocator table, multi-chain bridges) plus technique notes for Etherscan, DefiLlama,
  The Graph, and Dune — free-tier limits, coverage caveats, and the current wiring
  status of each source live there and drift, so read them there.

### GitHub

**Status snapshot — the build-state authority** — home: tracker
(`state/laniakea-status.json`, committed every scheduled run).
- Endpoint: the file in `soterlabs/wolfsclaw-laniakea-tracker`, via `gh api` or raw URL.
- Auth: `GITHUB_TOKEN` / `gh` CLI.
- Answers: release tags and latest-production per tracked repo, per-version audit
  inventories (parsed from audit-directory filenames, mixed separators handled), key
  PR states, deploy-output artifact listings, on-chain counters.
- Technique: machine-generated and bot-owned — read it, never edit it, and never treat
  a hand-written doc as fresher. Per-section error isolation: a failed section carries
  an `"error"` key, so consumers can distinguish zero from unknown; a 404 on an audits
  directory is itself meaningful data. Every dashboard number (version, audit firm, PR
  state, counter) MUST come from this file. Check `generated_at` before relying on it —
  more than 12h old is stale: flag the staleness and skip its ungroundable cells.

**Laniakea docs repo** — home: tracker (`collectors/github_docs.py`).
- Endpoint: GitHub REST on `sky-ecosystem/laniakea-docs` — `git/ref/heads/main`,
  `commits`, `compare/{base}...{head}`.
- Auth: `GITHUB_TOKEN`.
- Answers: any evolution of the Laniakea initiative docs.
- Technique: tree-SHA comparison on `main`; on change, walk commits to the last-known
  SHA, then one compare call for the file-level summary. Every change reports high —
  the repo is pure Laniakea, no keyword filter.

**Implementation repos** — home: tracker (`collectors/github_repos.py`; the tracked
list lives in `config.py:IMPLEMENTATION_REPOS`).
- Endpoint: `/repos/{repo}/commits|pulls|issues|releases`.
- Auth: `GITHUB_TOKEN`.
- Answers: build progress per in-scope repo — commits, new PRs and issues, release tags.
- Technique: commit SHA-walk bounded by the last run; state advances even when items
  are filtered out (seen is seen). The issues endpoint also returns PRs — skip via the
  `pull_request` key. Releases are always high severity (lesson baked into the
  collector: production release tags were missed before this check existed). Pure vs
  shared split: repos dedicated to Laniakea report everything; shared repos require
  keyword relevance on message/title/body, and release-note scoring includes the repo
  slug because release bodies are often bare. Atlas-edit and executive PRs in the
  shared atlas repo reclassify as governance, high. Commits batch into one update per
  repo with a shown-messages cap.

**Spell repos** — home: tracker (`collectors/github_spells.py`).
- Endpoint: per-branch commits plus per-commit file diffs on the tracked spell repos
  (the tracked list lives in the tracker's `config.py`, the same way the
  Implementation-repos list does).
- Auth: `GITHUB_TOKEN`.
- Answers: which executive-vote or poll spells touch Laniakea contracts.
- Technique: SHA-walk with chore-marker skip; two-stage relevance — commit message
  first, then fetch the full commit and scan the `.sol` patch content, because a
  generic title can hide PAU/NFAT touches. Quirk (observed): a Prime's spell can live
  in that Prime's OWN spell repo (a Grove spell landed in `grove-labs/grove-spells`,
  not the mainnet spell repo) — a spell-artifact check watching only the mainnet repos
  looks in the wrong place for days. Include the Prime spell repos when hunting spell
  artifacts.
- Preferred feed: `briefs/data/spells.json` + `spell-observations.json` (intel) for
  plan-vs-cast.

**PR detail, agent-consulted** — home: tracker VPS agents.
- Endpoint: `gh api repos/<owner>/<repo>/pulls/<n>`; list form
  `/pulls?state=all&sort=updated`.
- Auth: `gh` CLI / `GITHUB_TOKEN`.
- Answers: PR bodies when titles aren't self-explanatory; merge status.
- Technique: best-effort and time-capped, per the agent prompts.

**Peripheral research context** — home: tracker weekly agent.
- Endpoint: `.claude/LANIAKEA_CONTEXT.md` in the tracker repo.
- Answers: background framing — Stablewatch context, the audit landscape, competitive
  analogs, timeline risk.
- Technique: read at the start of weekly runs; refresh quarterly or when a HIGH SIGNAL
  item changes. A dated doc — discipline rule 2 governs it: its own supersession marks
  win, and machine-generated feeds win over it.

**Dev activity rollup** — home: intel.
- Endpoint: `briefs/data/dev-activity.json`.
- Answers: cross-repo dev activity — prefer it over re-scanning repos yourself.

### Metrics

**Metrics feeds** — home: intel.
- Endpoint: `briefs/data/metrics-latest.json` (market/protocol) and
  `briefs/data/stars-latest.json` (per-star readings).
- Auth: `GITHUB_TOKEN` / `gh` CLI.
- Answers: market and protocol metrics; per-star readings.
- Technique: these ARE the precomputed feed — never re-scrape chains or dashboards for
  numbers a feed already carries.

**BA Labs risk APIs** — home: tracker enrichment agent.
- Endpoint: unstable; see the enrichment prompt.
- Answers: risk parameters, when reachable.
- Technique: known to go down for long stretches — a consecutive-day outage count is
  tracked as a NON-event, declared rather than spun into a signal.

### Notion

Access quirk spanning all Notion entries: the Notion MCP is unreliable in headless
cron mode — the tracker's agents fall back to direct REST with `NOTION_TOKEN` and the
API version header (details in the tracker's CLAUDE.md). Hard rule from the tracker,
carried here: never @-mention people in Notion output.

**Archon Laniakea workspace** — home: tracker (`collectors/notion_workspace.py`).
- Endpoint: Notion API `search` (empty query, cursor-paginated) plus
  `blocks.children.list`.
- Auth: `ARCHON_NOTION_TOKEN` (dedicated read-only token; the collector silently skips
  when unset).
- Answers: the Laniakea team's own build status from their workspace pages.
- Technique: diff `last_edited_time` per page against state; skip untitled pages;
  preview changed pages from their first blocks; a high-priority title list in config
  drives severity. HARD RULE: read-only — never write under the workspace root
  `2f6b8769-3a5a-808d-a76a-f4c7c012fd11`.

**Archon delivery DB** — home: tracker weekly agent.
- Endpoint: Notion DB `1957c147-3923-415d-a491-86305c1729a1`, filtered on the
  `Last Linear Update - automation field` within the reporting window.
- Auth: `ARCHON_NOTION_TOKEN`.
- Answers: roadmap progress. Linear is the canonical delivery tracker; the Notion row
  is the pointer — pull `Linear Link`, `Sub-initiative`, `Status`, `Health`.
- Technique: never use page `last_edited_time` as the primary signal (it reflects PM
  surface activity — explicitly rejected); never invent a per-substage reporting
  framework the source doesn't carry.

**Laniakea Updates — daily page** — home: tracker output.
- Endpoint: Notion DB `c6ba7dac-7df9-4ed6-be1e-fee22d18fe2b`, one page per UTC day.
- Answers: the day's raw Laniakea signals, grouped by signal type, with an appended
  enrichment section (gate classification included).
- Technique: multiple runs per day append; the page is found via search plus exact
  title plus parent-DB check. Append-only — never edit tracker output.

**Sky Intelligence Briefs** — home: intel output.
- Endpoint: Notion DB `52c598a6989d4431b5ee604c17f78457`.
- Answers: synthesized ecosystem-wide intelligence — the newest Brief is the synthesis
  layer over the raw feeds.

**Laniakea Weekly** — home: tracker weekly agent output.
- Endpoint: Notion parent page `33bd79b5-de38-8074-ae6f-f63f1ceb8cb8`; published
  editions also live in `published/` in the intel repo.
- Answers: the weekly and monthly narrative.

**Mission Control** — home: tracker enrichment agent (its ONLY automated writer).
- Endpoint: Notion page `37dd79b5-de38-8118-b3b3-ee94778d7b33`.
- Answers: the aggregated program board. INTERNAL — it carries non-public dates, so
  its cells are not citable externally until a public artifact exists.
- Technique: writes are cell-level surgical edits only, never whole-section rewrites;
  every number in it must trace to the status snapshot.

### News

**Stablewatch research** — home: tracker (`collectors/stablewatch.py`).
- Endpoint: `https://www.stablewatch.io/sitemap.xml` — the site publishes NO RSS feed;
  sitemap diffing is the technique.
- Auth: none.
- Answers: primary-source risk and NFAT framing from the Laniakea core contributor.
- Technique: parse the sitemap XML (standard sitemap namespace), keep only `/blog/*`
  and `/research/*` paths, normalize to the canonical domain, diff against known-URLs
  state; titles derive from slugs. Everything high severity, no keyword filter.

**News RSS** — home: tracker (`collectors/news_rss.py`; the feed list lives in
`config.py:RSS_FEEDS`).
- Auth: none.
- Answers: external press explicitly mentioning Laniakea.
- Technique: feedparser; per-feed GUID dedup with a cap; an aggressive
  primary-keyword-only filter — the noisiest feeds get the tightest gate. HTML
  stripped, summaries kept short.

**Block Analitica Substack, direct read** — home: tracker enrichment agent.
- Endpoint: `https://blockanalitica.substack.com`.
- Answers: recent Sky Prime risk posts within the agent's daily window.
- Technique: best-effort, time-capped per the enrichment prompt.

**X/Twitter** — REMOVED by the operator's decision; do not re-add. The tracker's
social inventory file documents the accounts (no native API) for reference only, along
with Discord, Telegram, and Reddit — the current wiring status of each lives in that
inventory file; read it there.

## Use when / don't

- Applies when: fetching from, wiring up, or extending any Sky-ecosystem intelligence
  source; judging output built on Sky-sourced data; deciding which operating home a
  new Sky signal collection belongs to.
- Doesn't apply when: defining ecosystem vocabulary (route via `/consulting-sky-intel`'s
  Not-for clause); answering a routine current-state question (follow
  `/consulting-sky-intel`, which holds the question-class map — this registry is the
  per-source depth behind it); working the org's non-Sky sources (Gmail, Slack, Otter,
  the org's own Notion targets — their own guides and `targets.md` govern those).
