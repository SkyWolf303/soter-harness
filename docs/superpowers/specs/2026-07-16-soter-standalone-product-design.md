# Soter — Design Spec for the soter-harness Standalone Product

**Status:** Draft for implementation · **Date:** 2026-07-16 · **Chassis pin:** `opencode-ai` 1.18.3 (facts verified against opencode.ai docs, `sst/opencode` source, and the npm registry, 2026-07-16) · **Canonical source repo:** `/Users/wolf/soter-harness`

---

## Summary

Soter is a branded, standalone distribution of the soter-harness agent operating system, delivered as an npm-installable CLI (`soter`) that wraps a version-pinned OpenCode binary. The harness content that lives today in the source repo — the root `CLAUDE.md` plus the `.claude/` tree (22 skills, the single shared checker, MCP wiring) — remains the canonical single source; a build-time content bridge generates the OpenCode-shaped distribution from it, and a runtime enforcement plugin re-attaches the checker's protocol-neutral verdict functions to OpenCode's hook surface. All product code lives under `cli/` at the repo root, the sole declared exception to the no-new-scripts rule per ADR-0059's Decision (see Architecture overview). The four-point enforcement contract (pre-execution guard, post-write check, session context injection, turn gate) maps cleanly to OpenCode for three of four points; the turn gate has **no blocking equivalent** in OpenCode v1.18.3, so M0 is a kill-gate spike that measures whether the documented async re-injection workaround gives acceptable enforcement before any further investment.

## Goals

1. Ship the harness as a product a user can run with `npx @soterlabs/soter` on a repo that has never seen Claude Code — no Anthropic-tooling prerequisite, any Models.dev-catalog provider. Fresh repos are the primary target: the product-adapted CLAUDE.md ships inside the package and loads regardless of repo contents, and `soter init` scaffolds the on-repo assets the guides depend on (see Content bridge).
2. Preserve the enforcement contract for E1–E3: the same `check.mjs` verdicts (guard-bash, guard-write, post-write lint, session context) fire at the same semantic moments, with the same fail-open philosophy. E4 (turn gate) is subject to the M0 kill-gate verdict — workaround or gate-less-with-CI.
3. Single source of truth: `.claude/` is never forked. Every OpenCode-facing artifact is generated; regenerating from a clean tree produces a byte-identical output (CI drift check).
4. Deterministic runtime: exact-pin `opencode-ai@1.18.3` (its platform binaries are exact-pinned `optionalDependencies`, so the pin is fully deterministic — verified against the npm registry).
5. Branded first-run experience: splash banner, guided wizard, aegean-blue/gold theme, `/about`.
6. Key handling stays out of Soter entirely: provider credentials are stored by OpenCode's own auth flow (OpenCode's auth store, e.g. `~/.local/share/opencode/auth.json` on macOS/Linux); Soter never reads, writes, or proxies a secret.

## Non-goals

- Forking or patching the OpenCode binary or its source. Soter is configuration, content, and a plugin on top of a pinned upstream release.
- Replacing CI as the hard gate. As in the existing harness ("hook mode never blocks — CI is the hard gate"), in-session enforcement is belt-and-braces; the checker in `--all` mode remains the merge authority.
- Changing the authoring workflow. Skills are still authored, forged, evaluated, and promoted in `.claude/` under the existing rules and budgets; the bridge is one-way.
- Runtime multi-chassis support. One install targets one chassis; the Claude Code plugin distribution (`.claude/hooks/hooks.json`) continues to exist in parallel, unchanged.
- Porting the Claude marketplace plugin dependencies (`notion`, `slack` from `claude-plugins-official` in `.claude/.claude-plugin/plugin.json`). Marketplace plugins are Claude-Code-only; equivalent capability arrives as ordinary MCP servers (see MCP wiring and Open questions).
- Telemetry of any kind.

## Platforms

v1 supports **macOS (arm64, x64) and Linux (x64, arm64)**. Windows is explicitly deferred: the launcher detects `win32` and exits with a clear "Windows is not yet supported" error rather than degrading unpredictably, even though `opencode-ai` ships Windows platform binaries. All user-state and OpenCode-owned paths in this spec (`~/.config/soter/state.json`, the auth store, user themes dir) are illustrative of the default macOS/Linux layout; the launcher derives actual paths via the same platform conventions OpenCode itself uses (XDG base dirs on Linux, etc.), never by hard-coding literal `~/...` strings. The TUI/theme assumes a truecolor terminal (see Branding); `soter doctor` reports when the terminal lacks it.

## Architecture overview

All product code — launcher, bridge, generated payload, vendored checker — lives under `cli/` at the repo root. This tree is the declared exception to the harness's no-new-scripts standing rule, scoped by ADR-0059's Decision to chassis adaptation and packaging only; nothing product-side lives outside `cli/`, and no per-rule scripts are added anywhere.

Components:

1. **`soter` CLI** (`@soterlabs/soter`, bin `soter`, source `cli/bin/soter.mjs`) — Node launcher. Owns the splash, the first-run wizard, and subcommands (`soter`, `soter run`, `soter check`, `soter init`, `soter doctor`, `soter --version`). Sets environment (`OPENCODE_CONFIG`, `OPENCODE_CONFIG_DIR`, `OPENCODE_TUI_CONFIG` (M0-verify), `OPENCODE_DISABLE_CLAUDE_CODE=1` (M0-verify)) and execs the pinned `opencode` binary.
2. **Bundled config payload** (`cli/dist/config/`, generated) — the shipped payload: `opencode.json` (plugin, instructions, MCP — delivered via `OPENCODE_CONFIG`, see Config layering below), `CLAUDE.md` (product-adapted, see Content bridge), `commands/*.md` (one per skill), `themes/soter.json`, `tui.json`, `commands/about.md`, and the enforcement plugin under `plugins/`. A sibling `cli/dist/scaffold/` carries the on-repo assets `soter init` installs.
3. **Enforcement plugin** (`soter-enforcement`) — an OpenCode plugin (verified signature: `async ({ client, project, directory, worktree, $ }) => Hooks`) that translates OpenCode hook payloads into the exact stdin-JSON contracts `check.mjs` already parses, spawns `node check.mjs <mode> --root <dir>`, and translates exit codes back (exit 2 + stderr → block / re-prompt).
4. **Content bridge** (`cli/bridge/generate.mjs`) — build-time generator: reads the root `CLAUDE.md` and `.claude/` from the source repo, emits `cli/dist/config/` (including `cli/vendor/check.mjs`). Deterministic; run by `npm run build` and by CI as a drift check.
5. **`check.mjs`** — unchanged. Its Claude Code coupling is confined to the argv dispatcher (verified in the coupling inventory); all verdict functions (`checkAll`, `checkOne`, `gateVerdict`, `guardBashVerdict`, `guardAdrVerdict`, `sessionStartContext`) are protocol-neutral, and the existing stdin-JSON modes are reused as-is via the adapter. Root resolution already supports `--root <dir>`, which wins over all other resolution (verified, `check.mjs:1525–1534`), so the plugin never depends on `CLAUDE_PROJECT_DIR`. The bridge emits `cli/vendor/check.mjs` from `.claude/scripts/check.mjs`, so the existing regenerate-and-diff drift check covers it byte-for-byte.

**Checker version-skew policy.** `cli/vendor/check.mjs` is frozen at package publish, but a target repo may carry its own, newer `.claude/scripts/check.mjs`. Precedence: the enforcement plugin and `soter check` **prefer the project's `.claude/scripts/check.mjs` when present**, falling back to the vendored copy. Rationale: the repo's own checker is the merge authority (per Non-goals — CI runs the repo's checker), so in-session enforcement must agree with it, not with a stale snapshot. `soter doctor` reports skew between the vendored and project checker.

```
  soter-harness repo  (canonical source — unchanged)
  ├─ CLAUDE.md  (repo root)
  ├─ .claude/
  │   ├─ skills/*/SKILL.md      ├─ scripts/check.mjs
  │   ├─ .mcp.json              └─ settings.json / hooks/hooks.json  (Claude Code wiring, untouched)
  └─ cli/  (product code — the declared ADR exception)
        │
        │  build time: cli/bridge/generate.mjs  (one-way, deterministic)
        ▼
  @soterlabs/soter package
  ├─ cli/bin/soter.mjs ── splash · wizard · env setup · exec ▶ opencode (pinned 1.18.3)
  ├─ cli/dist/config/  ◀── OPENCODE_CONFIG (opencode.json) + OPENCODE_CONFIG_DIR (asset dirs)
  │   ├─ opencode.json   (plugin, instructions, mcp)            │ typed hooks
  │   ├─ CLAUDE.md       (product-adapted, from repo root)      ▼
  │   ├─ commands/*.md   (from SKILL.md)             soter-enforcement plugin
  │   ├─ themes/soter.json · tui.json ── spawn ▶ node check.mjs --guard-bash|--guard-write|
  │   └─ plugins/soter-enforcement.js               --hook|--gate|--session-start --root <dir>
  ├─ cli/dist/scaffold/  (assets `soter init` installs into a fresh repo)
  └─ cli/vendor/check.mjs  (bridge-emitted, byte-identical, fallback when the project has no checker)
```

**Config layering.** The verified, documented merge chain covers: global config → the `OPENCODE_CONFIG` config **file** → `OPENCODE_CONFIG_CONTENT` → project `opencode.json` → project `.opencode/` dirs. `OPENCODE_CONFIG_DIR` does **not** appear in that documented merge chain: the docs only say the dir is searched for agents/commands/plugins/etc. like a `.opencode` dir, loaded after global config. Whether an `opencode.json` placed inside `OPENCODE_CONFIG_DIR` is parsed as a config file at all, and at what merge position, is **unverified** and is an M0 open question. Soter therefore does not depend on it: the launcher sets `OPENCODE_CONFIG=<pkg>/cli/dist/config/opencode.json` to deliver the JSON payload (plugin registration, instructions, MCP) via a documented mechanism, and sets `OPENCODE_CONFIG_DIR=<pkg>/cli/dist/config` for the asset dirs (`commands/`, `plugins/`, `themes/`), which is what the docs actually describe the dir doing. Consequence of the merge chain: Soter's bundled defaults are overridable per-project by the user's own `opencode.json` — this is intended behavior, not a leak. Explicitly: a project's `opencode.json` can disable or replace the `soter-enforcement` plugin entirely, making E1 blocks user-defeatable per repo; this is accepted (belt-and-braces posture — CI remains the merge authority), and `soter doctor` reports when the plugin is overridden by project config. The launcher additionally sets `OPENCODE_DISABLE_CLAUDE_CODE=1` (existence and effect in 1.18.3: M0-verify — this variable is load-bearing for the "loads exactly once" invariant) so OpenCode's CLAUDE.md/skills compatibility fallbacks never double-load content the bridge already delivers deterministically.

## The enforcement contract

Chassis-neutral definition — these four points are what "the harness is on" means, independent of any hook protocol. Each point names the check.mjs mode that computes its verdict; the verdict functions are pure and the mode contracts are already stdin-JSON + exit-code shaped.

| # | Contract point | Semantics | check.mjs mode | Failure posture |
|---|---|---|---|---|
| E1 | **Pre-execution guard** | Before a shell command or file mutation runs, a verdict may deny it with a reason shown to the model. Covers: force-push and `+refspec` (lease allowed), shell writes to Accepted ADRs, `git add -A`, root-main git mutations, worktree-branch push/PR (guard-bash); ADR immutability with the single sanctioned Supersede edit (guard-write, ADR-0044) | `--guard-bash`, `--guard-write` | Fail-open on unparseable input; a computed block is absolute |
| E2 | **Post-write check** | After any file mutation, the changed file is linted and the report is surfaced to the model. Warn-only, never blocks (CI is the hard gate) | `--hook` | Always allow; report best-effort |
| E3 | **Session context injection** | At compaction/resume, a where-am-I block (root vs worktree, branch, live checker verdict, re-read-CLAUDE.md nudge) is injected into context; silent off-harness (ADR-0055) | `--session-start` | Always allow; silent on error |
| E4 | **Turn gate** | When the agent believes it is done, a full-repo check runs; error-level violations (excluding `SCAN_EMPTY`) hold the turn open with the first 10 violations fed back, blocking at most once per turn to prevent loops (ADR-0035) | `--gate` | Fail-open on internal error |

Note on E3 scope: in the existing Claude Code wiring the SessionStart hook is registered with matcher `compact` — the contract point is compaction-scoped context re-grounding, not every-session injection. **The compaction route alone satisfies E3 parity.** The fresh-session route in the mapping below is a deliberate OpenCode-only enhancement outside the E1–E4 contract.

## Enforcement mapping table

All OpenCode hook names below are verified typed hooks from `packages/plugin/src/index.ts` or documented event-bus types consumed via the `event` hook. Where the original design assumed a capability that the verified facts contradict, the correction is stated inline.

| Contract point | Claude Code wiring (today) | OpenCode mapping | Verification status |
|---|---|---|---|
| E1 pre-exec guard (shell) | `PreToolUse` matcher `Bash` → `--guard-bash`, exit 2 blocks | `tool.execute.before({ tool, sessionID, callID }, output)` — when the tool is the shell tool, synthesize `{cwd, tool_input:{command}}` from `output.args` + plugin `directory`, spawn `--guard-bash --root <dir>`; on exit 2, `throw new Error(<stderr>)`, which blocks execution (documented behavior). `permission.ask` (`output.status = "deny"`) is a secondary belt for permission-prompt resolution | Hook + throw-blocks: **verified**. Exact tool-id strings and args shape: **M0** |
| E1 pre-exec guard (write/edit) | `PreToolUse` matcher `Write\|Edit` → `--guard-write` | Same `tool.execute.before`; adapter translates OpenCode edit/write tool args into the `tool_input` schema `--guard-write` hard-codes (`file_path`+`content`, or `old_string`/`new_string`/`replace_all`) | Hook: **verified**. Args-shape translation table: **M0** |
| E2 post-write check | `PostToolUse` matcher `Write\|Edit` → `--hook`, always exit 0 | `tool.execute.after({ tool, sessionID, callID, args }, output)` — spawn `--hook` with `{tool_input:{file_path}}`; append the report to `output.output` (the hook may mutate the result — verified), so the model sees violations inline. Improvement over Claude Code, where the report goes to hook stdout | Hook + result mutation: **verified**. Tool ids and args shape: **M0** |
| E3 session context | `SessionStart` matcher `compact` → `--session-start`, emits `hookSpecificOutput.additionalContext` | Primary (contract): `experimental.session.compacting` — spawn `--session-start` with `{cwd}`, parse the emitted JSON, `output.context.push(additionalContext)`. Secondary (fresh sessions): `event` hook on `session.created` computes and caches the block per `sessionID`; `experimental.chat.system.transform` appends it on the next completion. **The fresh-session route is a deliberate OpenCode-only enhancement outside the E1–E4 contract** — the Claude Code wiring has no fresh-session injection (SessionStart is compact-matched) — so it is exempt from the adapter parity harness and non-blocking in M0. **Correction:** the design assumed a dedicated session-start hook; none exists as a typed hook — `session.created` is an event-bus type consumed via the single `event` hook | Compacting hook + event bus: **verified**. Injection-route ordering for fresh sessions: **M0 (non-blocking)** |
| E4 turn gate | `Stop` matcher `*` → `--gate`; exit 2 holds the turn open; `stop_hook_active` guards the loop | **Correction: no equivalent exists.** OpenCode has no hook that can hold a turn open; plugin `event` handlers are fire-and-forget — the returned promise is dropped, so a `session.idle` handler cannot block the idle transition (verified; open issue #16879). Mapping is a workaround: on `session.idle`, spawn `--gate --root <dir>` (stdin `{"stop_hook_active": false}`); if it exits 2, re-prompt the session via the SDK `client` with the `TURN GATE:` violation list. The blocks-only-once semantics of ADR-0035 move into the plugin: a per-session, **per-turn** flag replaces `stop_hook_active` — set when a gate re-prompt is issued, cleared when a subsequent gate run is green **and** re-armed on each new user turn (cleared when a user-role message event arrives on the event bus for that `sessionID`; the exact event type — e.g. `message.updated` with a user role — is an M0 verification item). This restores ADR-0035's per-turn semantics: without the turn-boundary reset, one red re-prompt would disarm the gate for the rest of the session. Non-interactive mode is a separate M0 question: under `opencode run`, the process may exit at turn completion before the fire-and-forget idle handler's re-prompt takes effect — E4 may be structurally dead in run mode even if the TUI workaround passes (see M0 deliverable 4) | Absence of a blocking gate: **verified**. Exact SDK re-prompt call, workaround efficacy, run-mode viability, and the user-message event type for flag re-arm: **M0 kill-gate** |

Adapter mechanics, common to all rows: the plugin never imports `check.mjs` (importing would execute its dispatcher); it spawns `node <checker> <mode> --root <projectDir>` — where `<checker>` is the project's `.claude/scripts/check.mjs` when present, else `cli/vendor/check.mjs` (see the version-skew policy in Architecture overview) — with a synthesized stdin JSON matching the mode's existing contract, a 5-second timeout, and fail-open on spawn failure or timeout for E2/E3/E4. `--root` is passed explicitly on every spawn, so none of the `CLAUDE_PROJECT_DIR` logic is exercised. `check.mjs` itself needs zero changes for M0–M2.

Checker-side follow-ups (M3, keeping the drift-catcher philosophy of ADR-0010):
- Extend the `PLATFORM_COUPLING` banned-token list with the OpenCode hook names (`tool.execute.before`, `session.idle`, `OPENCODE_CONFIG_DIR`, …) so chassis specifics stay quarantined in `system: platform` pieces on both chassis.
- Add a `BRIDGE_STALE` rule: regenerated `cli/dist/config/` must be byte-identical to the committed output (the OpenCode analogue of `HOOK_PARITY`, which stays Claude-Code-pair-scoped).
- Fold the adapter-parity fixtures into `--selftest` as a new stage (see Testing strategy), making the selftest literally the cross-chassis conformance bar the ADR's Consequences name — the selftest lives inside the one shared checker, which fits the extend-the-checker rule.

## Content bridge

One-way, build-time, deterministic. Input: a checkout of soter-harness. Output: `cli/dist/config/` (plus `cli/dist/scaffold/` and `cli/vendor/check.mjs`). Hand-editing generated files is forbidden; the CI drift check makes it structurally impossible to land.

### CLAUDE.md → instructions

- **Fact correction:** `CLAUDE.md` lives at the repo root (`/Users/wolf/soter-harness/CLAUDE.md`), not in `.claude/`.
- **Chosen content story for off-harness repos (this decision gates the bridge design and is not an M0 open question):** the bridge generates a **product-adapted CLAUDE.md into `cli/dist/config/CLAUDE.md`** from the repo-root source, so the harness operating instructions and the Guide index travel inside the package and load on every repo — including Goal 1's primary target, a fresh repo that has never seen Claude Code. A project-relative `"instructions": ["CLAUDE.md"]` alone would resolve against the user's repo and load nothing there.
- **Load-exactly-once selection, resolved by the launcher at startup** (the package install path is only known at runtime): the launcher stats `<project>/CLAUDE.md`. If the project carries its own root CLAUDE.md (a harness-tree repo), the instructions entry is the project-relative `"CLAUDE.md"`; if absent (fresh repo), the launcher injects the **absolute path** to the bundled `cli/dist/config/CLAUDE.md` via `OPENCODE_CONFIG_CONTENT` (a documented merge-chain mechanism). Exactly one of the two loads. `OPENCODE_DISABLE_CLAUDE_CODE=1` is set in both cases so OpenCode's own CLAUDE.md compatibility fallback cannot double-load either copy (that variable's existence and effect: M0-verify).
- **Scaffold for command dependencies:** the bundled commands reference on-repo assets (`.claude/templates/`, `.claude/RUBRIC.md`, `.claude/LEXICON.md`, `decisions/`) that do not exist on a fresh repo. `soter init` (also offered as wizard step 5) installs them from `cli/dist/scaffold/`. Until the scaffold is installed, guides that depend on those assets direct the user to run `soter init`; `soter doctor` reports missing scaffold assets on repos where bundled commands have been used.
- The `## Guide index` entries are written as `` `/name` `` slash forms, which is exactly OpenCode's command-invocation syntax, so the index survives untouched.
- The global `~/.config/opencode/AGENTS.md` path is left alone (user territory).

### SKILL.md → commands

Each `.claude/skills/<name>/SKILL.md` → `cli/dist/config/commands/<name>.md`. OpenCode resolves filename → `/name`, matching the harness's `/skill-name` invocation convention.

Frontmatter field mapping (source fields tallied from all 22 skills):

| SKILL.md field | OpenCode command frontmatter | Rule |
|---|---|---|
| `name` | *(filename)* | `commands/<name>.md`; `NAME_RE`, reserved/forbidden name rules already enforced source-side |
| `description` | `description` | Copied verbatim (folded `>-` blocks flattened). Budgets (`descriptionChars` 1024, totals) stay enforced on the source |
| `disable-model-invocation: true` (all 22) | *(dropped — pending M0 verification)* | The drop rests on the assumption that OpenCode commands are never model-invocable (user-invoked via `/name` only). Nothing in the verified research confirms whether command descriptions are exposed to the model for autonomous invocation, so this is an **M0 open question** with a concrete probe (see Open questions). If OpenCode does surface commands to the model, mitigation is investigated via the agent/command `hidden` or description-suppression options; until verified, the staged/promoted semantics are treated as at-risk, not structurally satisfied |
| `promotion-hold: <reason>` (1 skill) | *(excluded from output)* | Held pieces are not generated at all — a hold means "not shipped" |
| `layer`, `system`, `kind`, `mold` | *(dropped)* | Harness classification metadata, consumed only by `check.mjs` against the source tree; OpenCode has no counterpart fields and needs none |
| — | `agent`, `model`, `subtask` | Emitted only by per-skill overrides (below); never synthesized |

Body mapping:
- Bodies copy verbatim by default. The `PLATFORM_COUPLING` lint has already kept hook-event names and Claude-Code plumbing out of every non-`system: platform` body, so the corpus is chassis-neutral by construction — this is an existing asset, not new work.
- **Human gates carry over unchanged.** Every side-effecting guide's "explicit human okay" step (forge step 9, pushing-to-notion step 5 "Non-negotiable, even under time pressure", updating-a-notion-page step 6, and the rest inventoried in the coupling report) is prompt-level text and is preserved verbatim. Consequence for CI: `opencode run --auto` auto-approves permissions (behavior: M0-verify) and MUST NOT be used with side-effecting guides; the `soter run` refusal behavior for `--auto` is specified normatively in the CLI section.
- Supporting files (e.g. `pushing-to-notion/targets.md`): the generator copies the skill's sibling files to `cli/dist/config/commands/<name>/` and rewrites relative references in the body to the copied paths.
- **Per-skill overrides** (`cli/bridge/overrides/<name>.patch.md`) handle the three known chassis-specific spots, each an inventoried fact:
  - `running-evals`: references `subagents/agent-a<name>-*.jsonl` transcript paths (Claude Code runtime artifact) — override substitutes the OpenCode transcript location (M0 identifies it).
  - `pushing-to-notion/targets.md:183`: the MCP tool name `mcp__otter__fetch` — override substitutes OpenCode's MCP tool id for the same server/tool (exact naming scheme: M0).
  - "fresh-context subagent" phrasing (forge steps 4 and 8, running-evals, processing-email fan-out): maps to OpenCode's `subtask: true` / task mechanism; override adjusts the phrase where it names mechanics rather than intent.
- **Override file format** (the only sanctioned divergence channel, so its contract is fixed here): a `.patch.md` file is YAML frontmatter plus a replacement body —

  ```markdown
  ---
  anchor: |
    <verbatim source line(s), copied exactly from the SKILL.md or sibling file>
  file: <skill-relative path, defaults to SKILL.md>
  ---
  <replacement text for the anchored lines>
  ```

  The build fails — reporting the override file and the source file/line searched — unless the anchor matches the source **exactly once** (zero matches = drift; multiple matches = ambiguous). This is the drift catcher.
- Overrides should shrink over time: where a source spot can be reworded to chassis-neutral intent (e.g. "fresh-context subagent" phrasing → the primitive's type name, per `PLATFORM_COUPLING`'s own fix text), prefer fixing the source via a normal PR, leaving overrides only for the truly chassis-specific facts (the `mcp__otter__fetch` tool id, transcript paths). The override mechanism itself is to be acknowledged in the ADR's Consequences as the sanctioned, anchored divergence channel before the ADR is accepted.

### Other generated artifacts

- `.claude/.mcp.json` → `opencode.json` `"mcp"` block (mapping in the MCP section).
- `themes/soter.json` and `tui.json` (Branding section) are static assets, copied not generated.
- `commands/about.md` is a static asset.
- `cli/vendor/check.mjs` is emitted by the bridge from `.claude/scripts/check.mjs`, so the drift check covers it.
- `cli/dist/scaffold/` is emitted from the source repo's `.claude/templates/`, `.claude/RUBRIC.md`, `.claude/LEXICON.md`, and a `decisions/` seed — the assets `soter init` installs.
- `.claude/settings.json` / `hooks/hooks.json` are **not** bridged — their role is filled by the enforcement plugin, registered in the generated `opencode.json` (plugins in `OPENCODE_CONFIG_DIR` also auto-load from its `plugins/` dir; the explicit registration is kept for legibility).

## CLI & first-run flow

### Install and invocation

- `npm i -g @soterlabs/soter` or `npx @soterlabs/soter`. `package.json` pins `"opencode-ai": "1.18.3"` exactly; upstream's exact-pinned platform `optionalDependencies` make the resolved binary deterministic (verified).
- `soter [dir]` — interactive TUI session (default).
- `soter run "<message>" [--model provider/model] [--session id] [--format json] …` — passthrough to `opencode run` with Soter env applied; for CI and scripts. **`soter run` refuses to forward `--auto` unless `--i-know-what-auto-means` is also passed** (exit 1 with an explanation naming the human-gate guides); `opencode run --auto` auto-approves permissions (M0-verify) and must never run side-effecting guides unattended. This bullet is the normative home for the flag; the Content bridge section cross-references it.
- `soter check [files… | --all]` — delegates to the resolved checker (project `.claude/scripts/check.mjs` if present, else `node cli/vendor/check.mjs`), **always injecting `--root <resolved project dir>`** (the `[dir]` argument, else cwd / nearest git root). This injection is required, not optional: without `--root`, check.mjs's verified root resolution (check.mjs ~1526–1534) aims `--all`/`--selftest` two-directories-up-from-the-script — for the vendored copy that is the installed npm package's own tree, which would scan the wrong repo and exit clean on a red project. Exit 1 on error-level violations, exactly as today.
- `soter init` — installs the scaffold assets (`.claude/templates/`, `.claude/RUBRIC.md`, `.claude/LEXICON.md`, `decisions/` seed) from `cli/dist/scaffold/` into the target repo; idempotent, never overwrites existing files.
- `soter doctor` — environment report: opencode version pin match; auth presence via the `opencode` CLI if an auth-status subcommand exists (`opencode auth list` — existence: M0-verify), else an existence-only `stat` of the OpenCode auth store path (never reading contents); MCP reachability (`opencode mcp list` — subcommand surface: M0-verify); shipped-payload integrity hash over `cli/dist/` (the hash covers only the generated, immutable payload — per-user state is outside it, see First-run flow); vendored-vs-project checker skew; whether project config overrides the enforcement plugin; missing scaffold assets; `soter check --all` verdict.
- `soter --version` — `soter <x.y.z> (opencode-ai 1.18.3)`.

Every invocation sets: `OPENCODE_CONFIG=<pkg>/cli/dist/config/opencode.json`, `OPENCODE_CONFIG_DIR=<pkg>/cli/dist/config`, `OPENCODE_TUI_CONFIG=<pkg>/cli/dist/config/tui.json` (M0-verify), `OPENCODE_DISABLE_CLAUDE_CODE=1` (M0-verify), then execs the pinned binary with the user's argv.

**Non-interactive invocations never see the wizard.** `soter run`, `soter check`, `soter init`, `soter doctor`, and any invocation without a TTY skip the wizard and splash entirely (env-var/pre-existing auth assumed present), printing a one-line stderr note if first-run state is absent. Only the bare interactive `soter [dir]` on a TTY triggers first-run. This is what makes the M2 fresh-CI-machine exit criterion reachable: `soter run` on a fresh machine must not hang on a prompt.

### First-run flow

First run is detected by the absence of the Soter state file (default `~/.config/soter/state.json` on macOS/Linux, platform-derived — a marker recording wizard completion, the chosen default model, and the soter version that ran it; no secrets, ever). Per-user mutable configuration lives **only** in this state file — never in `cli/dist/config/`, which stays byte-immutable so the doctor integrity hash and the CI drift guarantee hold.

1. **Splash.** Clear screen, print the banner (Branding section) in aegean blue with the tagline in gold, plus the version line and the one-line non-affiliation notice.
2. **Provider auth.** Prompt "Connect a model provider" and shell out to `opencode auth login` (optionally pre-seeding `-p anthropic` as the highlighted default — the `-p` flag: M0-verify). Credentials land in OpenCode's auth store, owned entirely by OpenCode; Soter records only "auth flow completed: yes/no". Existing env-var API keys for the wizard's highlighted providers are detected by name presence only, against this fixed list: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENROUTER_API_KEY`. Providers outside the list are not auto-detected (the user can still connect them via `opencode auth login`). When a listed key is present, the step is skipped with a note.
3. **Default model.** Offer the provider's models (`provider_id/model_id` form); record the choice in the Soter state file. On subsequent launches the launcher passes `--model <choice>` through to the binary — the bundled `cli/dist/config/` is never written to, so the integrity hash and drift check stay valid. OpenCode's own last-used behavior takes over thereafter.
4. **MCP connections.** Show the bundled server list (Otter, from the bridge) with status; run `opencode mcp auth <name>` for any that need it (remote servers support automatic OAuth via Dynamic Client Registration — verified; the `mcp auth` subcommand surface itself: M0-verify). Each server is opt-in; declining disables it via config (`"enabled": false`, recorded in Soter state and applied via `OPENCODE_CONFIG_CONTENT`, not by editing the bundled payload).
5. **Workspace scaffold.** Offer `soter init`: installs the `.claude/` assets the bundled commands depend on (templates, RUBRIC, LEXICON, `decisions/` seed) and, if the target directory has no `AGENTS.md`/`CLAUDE.md`, optionally a minimal starter that points at the guide index (or `/init` on first session). Declining leaves the repo untouched; the bundled product CLAUDE.md still loads (see Content bridge), so the session is functional either way.
6. **Done.** Print "Run `/about` inside a session for licensing and version details," then start the session.

The wizard is resumable and idempotent: every step re-checks actual state (auth present? MCP authed? scaffold present?) rather than trusting the marker, so a killed wizard just continues on next launch.

## Branding

**Name and disclaimers.** Product name "Soter" — no "opencode" in the product or package name, which sidesteps the upstream README's naming request entirely; the non-affiliation note ("Soter is built on OpenCode and is not built by or affiliated with the OpenCode team") appears in the README, the splash, and `/about` regardless, since the trademark status of "OpenCode" is unverified. Soter's own code is proprietary (matching the plugin's `UNLICENSED` stance); the redistributed OpenCode is MIT, and its copyright + permission notice ships verbatim in `NOTICE` and `/about` (the MIT retention condition).

**Banner — PROVISIONAL.** The block below is a reconstruction (the agreed banner/tagline payload from the design conversation did not reach this spec — see Open questions) and must be reconciled against the design-conversation record **before M1 ships `/about`**, which is the first shipped rendering of it; the splash follows unchanged in M2. Rendered in aegean blue, tagline in gold:

```
  ███████╗ ██████╗ ████████╗███████╗██████╗
  ██╔════╝██╔═══██╗╚══██╔══╝██╔════╝██╔══██╗
  ███████╗██║   ██║   ██║   █████╗  ██████╔╝
  ╚════██║██║   ██║   ██║   ██╔══╝  ██╔══██╗
  ███████║╚██████╔╝   ██║   ███████╗██║  ██║
  ╚══════╝ ╚═════╝    ╚═╝   ╚══════╝╚═╝  ╚═╝
              the harness holds.
```

**Theme.** `themes/soter.json`, selected via `tui.json` `{"theme": "soter"}`. Verified format: `defs` block, hex or dark/light variant values, key groups `primary/secondary/accent/…`, `text*`, `background*`, `border*`, `diff*`, `markdown*`, `syntax*`; truecolor required. Normative palette anchors:

```json
{
  "defs": {
    "aegean":      { "dark": "#3E7CB1", "light": "#1D5C8A" },
    "aegeanDeep":  { "dark": "#16324F", "light": "#0F2A44" },
    "gold":        { "dark": "#D9A441", "light": "#B8860B" },
    "goldBright":  { "dark": "#F2C14E", "light": "#9A7B0A" },
    "ink":         { "dark": "#E8EDF2", "light": "#1B2530" },
    "mist":        { "dark": "#8CA3B8", "light": "#5C7288" }
  },
  "theme": {
    "primary": "aegean",
    "secondary": "mist",
    "accent": "gold",
    "error": { "dark": "#E5534B", "light": "#B3261E" },
    "warning": "goldBright",
    "success": { "dark": "#57AB5A", "light": "#2E7D32" },
    "info": "aegean",
    "text": "ink",
    "textMuted": "mist",
    "background": { "dark": "#0D1620", "light": "#F7FAFC" },
    "backgroundPanel": "aegeanDeep",
    "border": "aegean",
    "borderActive": "gold"
  }
}
```

The remaining `diff*`/`markdown*`/`syntax*` keys derive from these six defs (aegean family for structure, gold for emphasis, ink/mist for text); the full file is an M1 asset, validated by loading it in a live TUI.

**`/about`.** A bundled command (`commands/about.md`) whose body renders: banner + tagline, Soter version + OpenCode pin, the non-affiliation notice, the MIT notice for OpenCode, the pointer to `soter check` and the guide index, and support contact.

## MCP wiring

Bridged from `.claude/.mcp.json` (one server today) into the generated `opencode.json`:

| Source (`.mcp.json`) | Generated (`opencode.json` `"mcp"`) |
|---|---|
| `otter` — `type: "http"`, `url: "https://mcp.otter.ai/mcp"`, no credentials | `"otter": { "type": "remote", "url": "https://mcp.otter.ai/mcp", "enabled": true }` — auth via OpenCode's automatic OAuth/DCR (verified) or `opencode mcp auth otter` in the wizard (subcommand surface: M0-verify) |

Mapping rules for future servers: Claude `http`/`sse` → OpenCode `remote` (headers carried over; secrets referenced as `{env:VAR}`, never inlined — the `SECRET_LEAK` rule extends to generated output); Claude `stdio` → OpenCode `local` (`command` array, `environment`). Per-agent tool exposure uses OpenCode's `tools` globs if ever needed; not needed for the current single server. The `notion`/`slack` marketplace-plugin dependencies are explicitly not bridged (see Non-goals); their MCP-server replacements are an Open question.

## Milestones

**Sequencing: this is two plans, not one.** Plan A is the M0 spike alone — throwaway code whose deliverable is a written verdict. Plan B (M1–M3) is authored **only after** the M0 verdict, with the resolved open questions as its inputs: the M0 outcome (proceed / ship gate-less / kill) is a user decision that determines whether M1–M3 exist at all and what E4 looks like in M1, and roughly ten open questions feed M1 design (E4 mechanism, tool-id table, theme loading route, transcript paths, …). The M1–M3 sections below describe the intended shape so the spike knows what it is de-risking; they are provisional, not an implementation plan.

### M0 — Feasibility spike (kill-gate) — Plan A

Throwaway code, one to two weeks, against pinned 1.18.3. Deliverable: a written verdict answering every item in the Open questions section, plus a demo plugin proving:

1. **E1:** seeded `git push --force` attempts and seeded Accepted-ADR edits are blocked in a live session via `tool.execute.before` + spawn `--guard-bash`/`--guard-write`, with the checker's stderr reason visible to the model.
2. **E2:** writes that introduce a lintable violation get the `--hook` report appended to the tool result and the model reacts to it.
3. **E3:** the `--session-start` where-am-I block appears in context after a compaction (`experimental.session.compacting`) — **this compaction path is the contract point and the only E3 route that can fail the spike.** The fresh-session route (event + system-transform) is additionally attempted as a non-blocking OpenCode-only enhancement.
4. **E4 workaround:** on `session.idle` with a red repo, the plugin re-prompts the session with the `TURN GATE:` list. Efficacy is measured across **3 seeded-violation eval scenarios × 3 runs each** (including one pressure case, per the harness's own eval minimum): the bar is **≥ 7 of 9 runs reach green without human intervention, with zero loop incidents** (the per-turn blocks-only-once flag must prevent any loop in all 9). Additionally, verify whether the `session.idle` handler fires and the SDK re-prompt takes effect under `opencode run` — both bare and attached to a persistent `opencode serve` — since `event` handlers are fire-and-forget and the process may exit before the re-prompt lands. If E4 cannot work in run mode, it is scoped to TUI sessions explicitly and CI/run-mode enforcement is `soter check --all` only (Testing strategy items 4–5 adjust accordingly).

**Kill criteria** (verified by the user reviewing the raw session transcripts, not the implementer's summary):

- **E1:** 10/10 seeded force-push attempts **and** 10/10 seeded Accepted-ADR edits blocked before execution, with the checker's stderr reason visible in the model transcript every time. Any miss = kill.
- **E2:** 10/10 seeded violations produce the `--hook` report in the tool result. Any miss = kill.
- **E3:** failure of the **compaction route** is a kill — it is the contract point. Failure of the fresh-session route is acceptable degradation (it has no Claude Code counterpart and is outside the contract).
- **E4:** if the workaround misses its ≥ 7/9 + zero-loops threshold, escalate a decision between shipping gate-less (CI remains the hard gate, consistent with existing E2 posture) and killing — that call is the user's, made on the M0 evidence, not the implementer's.

### M1 — Bridge + package (Plan B, authored post-verdict)

Bridge generator with overrides and drift check; npm package skeleton with exact pin; enforcement plugin productionized (fail-open table below, per-turn gate flag, timeouts); theme file completed and TUI-verified; `/about` (banner reconciled — see Branding); `soter check` (with `--root` injection) and `soter run` (with the `--auto` guard) passthroughs; `soter init` scaffold. Exit: a session launched via `soter` on a scratch repo enforces E1–E3 (and E4 per the M0 verdict) with all 21 shipped commands invocable and their scaffold dependencies installable via `soter init`.

### M2 — First-run experience

Splash, wizard (all 6 steps, resumable), `soter doctor`, state marker, README + non-affiliation/license compliance pass. Exit: a fresh machine with only Node installed reaches a working themed session in one `npx` command and one provider login — and `soter run` on that same fresh machine completes non-interactively without ever seeing the wizard.

### M3 — Distribution + parity

Publish to npm; CI: bridge drift check (covering `cli/dist/config/` and the bridge-emitted `cli/vendor/check.mjs`), adapter parity fixtures folded into `check.mjs --selftest`, eval suite green on the Soter chassis for all promoted guides; checker follow-ups (`PLATFORM_COUPLING` token extension, `BRIDGE_STALE`); documented OpenCode upgrade playbook — bump the pin only behind a re-run of the M0 hook-contract smoke suite (including the command model-invocability probe), since the enforcement plugin leans on `experimental.*` hooks that upstream may change.

## Error handling

Governing rule, inherited from `check.mjs`: **fail open everywhere except a successfully computed block.** The enforcement layer must never brick a session; a broken harness that silently allows is recoverable by CI, a broken harness that blocks everything is not.

| Failure | Behavior |
|---|---|
| Adapter can't parse an OpenCode hook payload / unknown tool id | Allow; log one stderr warning per session per shape |
| `check.mjs` spawn fails or exceeds 5 s timeout | E1: allow + warning (mirrors guard fail-open on unparseable stdin); E2/E3: skip silently; E4: skip gate this idle |
| `check.mjs` exits 2 with stderr (E1) | Block: `throw new Error(stderr)` — the one non-open path, and it is checker-computed, never adapter-computed |
| Gate re-prompt fails (SDK error) | Log; do not retry within the same idle; the gate flag stays clear so the next idle retries |
| Gate loop risk | Per-turn blocks-only-once flag (ADR-0035 semantics ported, including the per-turn reset). Lifecycle: **set** when a gate re-prompt is issued; **cleared** when a subsequent gate run is green; **also cleared (re-armed)** when a new user-role message event arrives on the event bus for that `sessionID` — the turn boundary (exact event type: M0). Without the turn-boundary clear, one red re-prompt would disarm the gate for the rest of the session |
| Off-harness project (no `.claude/`, no root CLAUDE.md) | E3 emits nothing (ADR-0055 silent-off-harness), E4 skips; E1/E2 verdict functions no-op on paths they don't govern. The bundled product CLAUDE.md still loads (Content bridge), and `soter init` brings the repo on-harness |
| Project config disables/replaces the enforcement plugin | Accepted by design (see Config layering); `soter doctor` reports it; CI remains the merge authority |
| Wizard interrupted | Idempotent resume; every step re-verifies real state |
| Pin drift (foreign `opencode` on PATH, payload hash mismatch, vendored-vs-project checker skew) | `soter doctor` reports it; launcher warns but does not refuse (the plugin still degrades fail-open under an unknown version) |
| `opencode run` exit codes needed by CI wiring | Not relied upon until M0 verifies them; `soter run --format json` asserts on JSON events instead |

## Testing strategy

1. **`check.mjs --selftest`** — keeps covering the Claude Code protocol shapes and all verdict fixtures (8 stages) through M2 unchanged. In M3 the adapter-parity fixtures (item 2) fold in as a ninth stage, at which point the selftest — inside the one shared checker, per the extend-the-checker rule — is literally the cross-chassis conformance bar the ADR's Consequences name.
2. **Adapter parity fixtures** (M1, run standalone until the M3 selftest fold-in): for each contract point, plant the same fixture repo, feed (a) the Claude-Code-shaped stdin directly to `check.mjs` and (b) the OpenCode-shaped payload through the adapter's translation, and assert identical verdicts and reasons. This is the structural guarantee that the two chassis enforce the same harness. **Carve-out:** the E3 fresh-session route is exempt — it is a deliberate OpenCode-only enhancement with no Claude Code counterpart (see the E3 mapping row); parity asserts E1, E2, E4's gate verdict, and E3's compaction route only.
3. **Bridge golden tests**: a checked-in miniature source tree → expected `cli/dist/` output, byte-diffed; plus the CI drift check on the real tree (regenerate, `git diff --exit-code`), which covers `cli/dist/config/`, `cli/dist/scaffold/`, **and** the bridge-emitted `cli/vendor/check.mjs` — a silently diverged vendored checker cannot land.
4. **Live E2E** (M1+, CI): `soter run` against a scratch repo with seeded violations, asserting via `--format json` event streams that E1 blocks fire and E2 reports appear; plus a test asserting `soter check --all` on a seeded-violation scratch repo exits 1 (guarding the `--root` injection — a bare vendored proxy would scan the wrong tree and pass). E4 coverage follows the M0 run-mode verdict: if E4 works under `opencode run`, the M0 eval scenarios become the permanent gate-efficacy suite here; if E4 is TUI-scoped, CI's run-mode gate is `soter check --all` and the gate-efficacy suite runs against a TUI/serve-attached driver instead.
5. **Eval suite on the Soter chassis** (M3): every promoted guide's existing evals (≥ 3 cases including a pressure case) re-run under `soter run`; goldens re-stamped per the existing `passed: <sha>` discipline only when steps actually changed. Turn-gate assertions in these evals follow the same M0 run-mode verdict as item 4.
6. **Theme/branding smoke**: load `soter.json` in a truecolor TUI in both dark and light; splash renders within an 80-column terminal.

## Open questions / M0 spike must answer

1. **Turn-gate workaround efficacy** (the kill-gate): does `session.idle` → SDK re-prompt reliably drive the model back to green (3×3 runs, ≥ 7/9 bar); what is the exact SDK `client` call to prompt an existing session; and does the handler fire + re-prompt land under `opencode run`, both bare and attached to a persistent `opencode serve`?
2. **User-message event type for E4 flag re-arm**: the exact event-bus type (e.g. `message.updated` with a user role) that marks a turn boundary, needed to restore ADR-0035's per-turn semantics.
3. **Tool id strings and args shapes** as seen by `tool.execute.before`/`after` for the shell and file-edit/write tools (needed for the E1/E2 translation tables; the agent-permission keys `bash`/`edit`/`read` are suggestive but are permission keys, not verified tool ids).
4. **`opencode run` exit-code semantics** (undocumented) — determines whether `soter run` can carry pass/fail natively in CI or must parse `--format json`.
5. **`OPENCODE_DISABLE_CLAUDE_CODE=1`** — verify it exists in 1.18.3 and disables the CLAUDE.md/skills compatibility fallback. **Must-verify:** double-loading CLAUDE.md content silently breaks the "loads exactly once" invariant that the whole instructions design leans on.
6. **`OPENCODE_CONFIG_DIR` as config source**: whether an `opencode.json` inside it is parsed as a config file at all, and its merge position. Delivery no longer depends on it (`OPENCODE_CONFIG` carries the JSON payload — see Config layering), but this must be verified to rule out the payload being applied twice.
7. **Unverified CLI/env surface**: `OPENCODE_TUI_CONFIG`; `opencode auth login -p <provider>`; existence of an auth-status subcommand (`opencode auth list` or equivalent — `soter doctor`'s fallback is an existence-only stat of the auth store, never reading it); `opencode mcp list` and `opencode mcp auth <name>`; `opencode run --auto` and its permission-auto-approve behavior (the `--i-know-what-auto-means` guard depends on it).
8. **Command model-invocability**: verify that OpenCode commands are never autonomously invocable by the model (the `disable-model-invocation` drop rests on this). Concrete probe: ask the model to run a bundled command unprompted and inspect whether command metadata appears in the system prompt / tool list. If commands are model-visible, investigate the agent/command `hidden` or description-suppression options as mitigation.
9. **Theme loading from `OPENCODE_CONFIG_DIR`**: docs say the dir is searched "like a `.opencode` dir" for agents/commands/plugins "etc." — confirm `themes/` is included; fallback is installing the theme to the user themes dir (platform-derived, e.g. `~/.config/opencode/themes/`) from the wizard.
10. **MCP tool naming** in OpenCode sessions (rewrite target for `mcp__otter__fetch` in `pushing-to-notion/targets.md:183`).
11. **Fresh-session injection route ordering** for E3 (non-blocking — the compaction route alone is the contract point): confirm a block cached at `session.created` and appended via `experimental.chat.system.transform` lands before the first completion.
12. **Subagent/transcript mechanics** for the `running-evals` override: OpenCode's equivalent of `subagents/agent-a<name>-*.jsonl` transcript paths, and how `subtask: true` sessions surface artifacts.
13. **Instructions path resolution**: confirm project-relative `"instructions"` entries resolve against the project in all launch modes (TUI from subdirectory, `run` with `[dir]`); confirm absolute-path entries injected via `OPENCODE_CONFIG_CONTENT` load as expected; confirm behavior when a listed instructions file is absent (the launcher's stat-based selection should make this moot, but verify the failure mode).
14. **MCP replacements for the `notion`/`slack` marketplace-plugin dependencies**: which concrete MCP servers (URLs, auth mode) restore that capability, and whether they enter the bundled config or stay wizard-added per user.
15. **Banner/tagline reconciliation**: the design-decision payload did not reach this spec's author (it arrived empty), so the ASCII banner and tagline in the Branding section are a PROVISIONAL reconstruction consistent with the decided splash/aegean-gold direction — confirm them against the design-conversation record before M1 ships `/about` (the first shipped rendering); the splash follows in M2 unchanged. No other section of this spec depends on that payload; everything else is grounded in the verified OpenCode facts and the repo coupling inventory.
