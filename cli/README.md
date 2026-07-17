# Soter — the harness as a product

```
███████╗ ██████╗ ████████╗███████╗██████╗
██╔════╝██╔═══██╗╚══██╔══╝██╔════╝██╔══██╗
███████╗██║   ██║   ██║   █████╗  ██████╔╝
╚════██║██║   ██║   ██║   ██╔══╝  ██╔══██╗
███████║╚██████╔╝   ██║   ███████╗██║  ██║
╚══════╝ ╚═════╝    ╚═╝   ╚══════╝╚═╝  ╚═╝
         H  A  R  N  E  S  S

         nothing goes unguarded
```

Soter ships the soter-harness (guides, molds, LEXICON, RUBRIC, the checker) as a
standalone, provider-agnostic agent CLI, built as a thin branded distribution of a
version-pinned [OpenCode](https://opencode.ai). Soter is not built by or affiliated
with the OpenCode team; OpenCode's MIT notice ships in `NOTICE`.

## Install & run

```sh
# from this directory (development):
npm install && npm link      # puts `soter` on PATH, pointing at this checkout

soter                        # interactive session (splash → first-run notes → TUI)
soter <dir>                  # same, rooted at <dir>
```

First run: connect a provider with `soter auth login` (keys live in OpenCode's own
auth store — Soter never reads or writes a secret). OpenCode's free tier works with
zero keys. macOS/Linux only; Windows is refused with a clear error.

## Subcommands

| Command | What it does |
|---|---|
| `soter run "<msg>" [...]` | non-interactive session; `--auto` is refused without `--i-know-what-auto-means` (side-effecting skills must not run unattended) |
| `soter check [files\|--all]` | run the harness checker against the project (project's own checker wins over the vendored copy) |
| `soter init [dir]` | install the harness scaffold (never overwrites) |
| `soter skills` | list loaded Soter Skills — proven vs staged |
| `soter doctor` | environment + integrity report; exits 1 on failures |
| `soter auth\|mcp\|models\|attach\|session\|export\|stats` | passthrough to the pinned opencode with Soter env applied |
| `soter upgrade` / `uninstall` | deliberately disabled — the OpenCode version is pinned; update Soter itself |

## Layout

- `bin/soter.mjs` — launcher: splash, root resolution, env wiring, subcommands
- `bridge/generate.mjs` — build-time content bridge: `.claude/` + `CLAUDE.md` →
  `dist/config/` (commands, instructions, runtime notes, theme, plugin, manifest)
  and `dist/scaffold/` + `vendor/check.mjs`. `dist/` is committed and drift-checked
  in CI (`soter-cli` job) — regenerate with `npm run build`, never hand-edit
- `assets/plugins/soter-enforcement.js` — the OpenCode plugin speaking the harness
  enforcement contract (E1 pre-exec guard, E2 post-write check, E3 session context,
  E4 turn gate). Fail-open everywhere except a computed block
- `test/` — adapter tests; `npm test` runs cold (bootstraps its own scratch repo),
  or set `SOTER_TEST_REPO=<scaffolded repo>` to reuse one

## Debugging

- `SOTER_DEBUG=1 soter ...` — plugin hook tracing to stderr
- The otter MCP server is declared `enabled` — expect an auth toast in the TUI until
  `opencode mcp auth otter` (or decline it; it's opt-in per user)
- OpenCode materializes `node_modules/`, `package.json`, `.gitignore` into
  `dist/config/` at runtime — gitignored; `npm run build` wipes and regenerates dist

## Known limits

- The TUI zero-state wordmark says "opencode" — not brandable in the pinned release
  (upstream TUI plugins are in flight; revisit at the next pin bump)
- E4 (turn gate) is a workaround over `session.idle` + SDK re-prompt; its live
  efficacy bar (spec: 3 scenarios × 3 runs, ≥7/9) has not been formally run
- Already-scaffolded repos keep their checker copy (`soter init` never overwrites);
  `soter doctor` reports skew — refresh by deleting and re-running init for now
