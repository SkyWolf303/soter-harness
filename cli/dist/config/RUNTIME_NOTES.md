# Soter runtime notes (generated)

- The project CLAUDE.md's guide index lists PROMOTED Soter Skills only. ALL skills —
  staged included — are available as /commands; the full listing with descriptions is
  `skills-manifest.json` in the Soter config dir (path below), or `soter skills` in a
  terminal. Where the project carries the harness tree, each skill's body is at
  `.claude/skills/<name>/SKILL.md`; otherwise read the bundled command body itself.
  When a user request matches a skill's territory, follow that skill: the staged flag
  gates auto-invocation, not user-requested work.
- A skill's sibling assets (e.g. `skill-assets/<name>/<file>`) resolve relative to
  the Soter config dir (path below).
- Domain vocabulary (including the Sky ecosystem) is defined in the harness LEXICON
  (`.claude/LEXICON.md` where the project carries it) — consult it before answering
  domain questions, and never redefine its terms.
- The skill set is meant to GROW: when a request exposes a gap no skill covers, or a
  correction repeats, suggest forging a new skill (/forge) or landing the correction
  as a gotcha or eval case on the governing skill. Suggest — the user decides.

## Skill routing map (match the user's words against these BEFORE asking for clarification)

- /auditing-a-schema-doc — Keeps a subject's policy-standard Fields section and targets.md mirror true to the live DB, drift reconciled through a human gate. Use to audit, reconcile, or fix a schema doc or push target.
- /authoring-a-policy-standard — Authors or expands one subject's rules-first policy standard in the org's registry — rules gathered never invented, gaps stay not-defined, the write gated. Use to author, draft, expand, or revise a policy standard.
- /capturing-a-contact — Captures a person as a [DB] Contacts row — live schema, real options only, the Org relation resolved or left empty, de-duped, confirmed before the write. Use to add, capture, or log a contact or person into the CRM.
- /capturing-a-feature — Turns a raw idea or use-case into a Feature Board card — the why captured in Description, status Planned, on the real board. Use to capture a new feature, log an idea, or start tracking something to build.
- /capturing-a-process — Captures a repeatable process as a [DB] Process Inventory entry — row per the live schema, body per the process shape standard, de-duped and confirmed before the write. Use to capture, document, or define a process.
- /capturing-a-task — Captures an actionable item as a [DB] Tasks row — shaped to the live schema, relations resolved never fabricated, dates pinned, de-duped, confirmed before the write. Use to capture, log, add, or create a task.
- /capturing-an-org — Captures an organization as a [DB] Orgs row — Type classified from prose (sector words go to Tags), handles normalized to URLs, de-duped hard (orgs are relation targets). Use to add, capture, or log an organization or company into the CRM.
- /consulting-sky-intel — Answers questions about current Sky/Laniakea ecosystem state — deployment and build status, spell schedule and casts, governance outcomes, star metrics, Laniakea rollout progress — by consulting the org's live intelligence sources (the Laniakea tracker's status snapshot, the Sky Intelligence Briefs, the structured data feeds) and citing them, never from model recall. Use when a task needs a current Sky ecosystem fact or a Sky/Laniakea status summary.
- /forge — Authors a new harness piece — guide, rule, standard, mold, or system — from its mold, with evals, a pressure test, and the human gate. Use when the user says forge or asks to add a guide, rule, standard, or system to the harness.
- /ingesting-slack-channels — Turns Slack channels into [DB] Channels rows — a human curates which enter at an intake gate, members resolve to real [DB] Contacts, existing rows update not duplicate. Use to ingest, sweep, or sync Slack channels into the CRM.
- /processing-a-meeting — Turns one recorded meeting into linked records — templated summary with project attributions, grounded tasks, row fills, review digest — stale items triaged, one gated batch. Use to process, digest, or extract a meeting, transcript, or action items.
- /processing-email — Triages a bounded window of the Gmail inbox interactively: fan-out readers classify threads, one gate presents the table and proposed writes, and on the human's okay it files with AI/* labels, drafts replies (never sends), captures tasks/updates via their owning guides, and digests to the AI Inbox. Use to process, triage, sort, file, or catch up on email, the inbox, or Gmail.
- /promoting-pieces — Walks the promotion decision for a staged harness piece — real-use evidence verified from artifacts, then a guide-index entry and (read-only guides) auto-invocation. Use to promote a piece or enable auto-invocation.
- /pushing-to-notion — Pushes a structured harness artifact to a Notion database as a new typed page, a human confirming before the write. Use to push, send, publish, or sync something to Notion, or create a database row/page from harness output.
- /red-teaming-a-process — Red-teams a documented process: a fresh read-only agent sweeps five lenses and findings return verified and ranked, never silently fixed. Use when the user says red-team, stress-test, or review a process before it goes Active.
- /reviewing-a-repo — Turns a code repo into Notion records — a tooling page plus human-curated feature cards; existing entries updated, not duplicated. Use to ingest, review, or "suck in" a repo into Notion.
- /reviewing-forge-output — Walks the human gate for a forge-drafted piece — everything to verify beyond the checker before saying merge. Use when a forge run reaches its gate or a drafted guide, rule, or standard needs review.
- /running-evals — Runs an eval scenario as a fresh-context, write-contained subagent; verdicts come from artifacts, never self-report. Use to run or re-run eval cases and record goldens.
- /updating-a-notion-page — Updates an existing Notion page safely — fetch-merge-write so nothing is clobbered, only named properties touched, a human confirming first. Use to update, edit, or append to an existing Notion page or card.
- /updating-project-status — Writes a project's status update as a typed Status row in [DB] Update Feed — progress computed from real tasks and milestones, health tags synced, confirmed before the write. Use for a status update, weekly update, project status, or health check on a [DB] Projects page.
- /validating-resources — Sweeps every [DB] Resources record against the Resources policy standard and reality (admins, URL liveness, cross-record claims) into a drift report; fixes applied only on a human okay. Use to validate, audit, or sweep the resources records.
- /writing-adrs — Records a decision as a well-formed ADR in decisions/ — context, choice, consequences, in the house shape. Use when the user says record this decision or write an ADR, or a durable choice emerges mid-task.
