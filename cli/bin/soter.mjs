#!/usr/bin/env node
// soter — the harness as a product. Wraps a version-pinned OpenCode with the
// soter-harness content bridged in and the enforcement plugin armed.
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_DIR = path.join(CLI, 'dist', 'config')
const VENDORED_CHECKER = path.join(CLI, 'vendor', 'check.mjs')
const OPENCODE = path.join(CLI, 'node_modules', '.bin', 'opencode')
const PKG = JSON.parse(readFileSync(path.join(CLI, 'package.json'), 'utf8'))
const VERSION = PKG.version
const PIN = PKG.dependencies['opencode-ai']

// ---- colors (truecolor with 256-color fallback)
const tty = process.stdout.isTTY
const truecolor = /truecolor|24bit/i.test(process.env.COLORTERM || '')
const aegean = (s) => !tty ? s : truecolor ? `\x1b[38;2;62;124;177m${s}\x1b[0m` : `\x1b[36m${s}\x1b[0m`
const gold = (s) => !tty ? s : truecolor ? `\x1b[38;2;217;164;65m${s}\x1b[0m` : `\x1b[33m${s}\x1b[0m`
const dim = (s) => !tty ? s : `\x1b[2m${s}\x1b[0m`

const BANNER = `
███████╗ ██████╗ ████████╗███████╗██████╗
██╔════╝██╔═══██╗╚══██╔══╝██╔════╝██╔══██╗
███████╗██║   ██║   ██║   █████╗  ██████╔╝
╚════██║██║   ██║   ██║   ██╔══╝  ██╔══██╗
███████║╚██████╔╝   ██║   ███████╗██║  ██║
╚══════╝ ╚═════╝    ╚═╝   ╚══════╝╚═╝  ╚═╝
         H  A  R  N  E  S  S`

const splash = () => {
  console.log(aegean(BANNER))
  console.log(gold('\n         nothing goes unguarded\n'))
  console.log(dim(`  soter ${VERSION} · opencode ${PIN} · Soter is built on OpenCode and is not affiliated with the OpenCode team\n`))
}

const isDir = (p) => { try { return statSync(p).isDirectory() } catch { return false } }

// The enforcement root: walk up from a start dir to the nearest ancestor that
// looks like a project root (CLAUDE.md, .claude/, or .git). Launching from a
// subdirectory must not misroot the guard or double-load instructions.
const findRoot = (start) => {
  let dir = path.resolve(start)
  for (;;) {
    if (existsSync(path.join(dir, 'CLAUDE.md')) || existsSync(path.join(dir, '.claude')) || existsSync(path.join(dir, '.git'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return path.resolve(start)
    dir = parent
  }
}

const KNOWN_SUBS = new Set(['run', 'check', 'init', 'doctor', 'skills', 'auth', 'mcp', 'models', 'attach', 'session', 'export', 'stats', '--version', '-v'])
const BLOCKED_SUBS = new Set(['upgrade', 'uninstall']) // would break the version pin / remove shared state

const argvRaw = process.argv.slice(2)
const sub = argvRaw[0]

// projectDir: a positional directory is honored ONLY on the bare TUI route
// (`soter [dir]`) and only when it IS a directory — subcommand tokens and flag
// values must never be mistaken for the project (observed: `soter --agent build`
// in a repo with build/ silently misrooted the guard).
const projectDir = (() => {
  if (sub && !sub.startsWith('-') && !KNOWN_SUBS.has(sub) && !BLOCKED_SUBS.has(sub) && isDir(sub) && argvRaw.length === 1)
    return findRoot(sub)
  return findRoot(process.cwd())
})()
const projectChecker = path.join(projectDir, '.claude', 'scripts', 'check.mjs')
const checker = existsSync(projectChecker) ? projectChecker : VENDORED_CHECKER

const stateDir = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'soter')
const stateFile = path.join(stateDir, 'state.json')

const opencodeEnv = () => {
  const env = {
    ...process.env,
    OPENCODE_CONFIG: path.join(CONFIG_DIR, 'opencode.json'),
    OPENCODE_CONFIG_DIR: CONFIG_DIR,
    OPENCODE_TUI_CONFIG: path.join(CONFIG_DIR, 'tui.json'), // inert if this OpenCode ignores it
    OPENCODE_DISABLE_CLAUDE_CODE: '1', // keep OpenCode's own CLAUDE.md fallback from double-loading
    SOTER_CHECKER: checker,
    SOTER_ROOT: projectDir,
    SOTER_NODE: process.execPath, // the plugin runs under OpenCode's Bun; give it real node
  }
  // Instructions, load-exactly-once: the runtime context always loads (staged-skills
  // rule, LEXICON pointer, and the launch-time facts: config dir + project root);
  // the bundled product CLAUDE.md loads ONLY when the project root has none.
  const instructions = []
  try {
    const notes = readFileSync(path.join(CONFIG_DIR, 'RUNTIME_NOTES.md'), 'utf8')
    const ctxFile = path.join(stateDir, 'runtime-context.md')
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(ctxFile, notes +
      `\n- The Soter config dir (bundled commands, skill-assets/, skills-manifest.json): ${CONFIG_DIR}\n` +
      `- The enforcement root for this session: ${projectDir}\n`)
    instructions.push(ctxFile)
  } catch { /* notes are additive — never block a launch */ }
  // load-exactly-once: the launcher is the single composer of instructions (the
  // generated opencode.json deliberately carries none) — project CLAUDE.md when
  // the repo has one, the bundled product copy when it doesn't, never both
  const projectClaudeMd = path.join(projectDir, 'CLAUDE.md')
  instructions.push(existsSync(projectClaudeMd) ? projectClaudeMd : path.join(CONFIG_DIR, 'CLAUDE.md'))
  env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ instructions })
  return env
}

// Theme: install into the user themes dir only when absent — a user's edits are
// theirs to keep (doctor reports drift against the shipped copy instead).
const ensureTheme = () => {
  try {
    const src = path.join(CONFIG_DIR, 'themes', 'soter.json')
    const dst = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'opencode', 'themes', 'soter.json')
    if (!existsSync(dst)) {
      mkdirSync(path.dirname(dst), { recursive: true })
      writeFileSync(dst, readFileSync(src, 'utf8'))
    }
  } catch { /* cosmetic — never block launch */ }
}

const execOpencode = (args, opts = {}) => {
  if (process.platform === 'win32') { console.error('soter: Windows is not yet supported'); process.exit(1) }
  if (!existsSync(OPENCODE)) { console.error('soter: pinned opencode binary missing — reinstall @soterlabs/soter'); process.exit(1) }
  ensureTheme()
  const r = spawnSync(OPENCODE, args, { stdio: 'inherit', env: opencodeEnv(), ...opts })
  if (r.error) { console.error(`soter: failed to launch opencode: ${r.error.message}`); process.exit(1) }
  if (r.signal) { console.error(dim(`soter: opencode terminated by ${r.signal}`)); process.exit(1) }
  process.exit(r.status ?? 1)
}

const usage = () => {
  console.log(`usage: soter [dir]                  interactive session (the TUI)
       soter run "<message>" [...]  non-interactive; --auto requires --i-know-what-auto-means
       soter check [files|--all]    run the harness checker against the project
       soter init [dir] [--refresh] install the harness scaffold; --refresh updates drifted files
       soter skills                 list loaded Soter Skills
       soter doctor                 environment + integrity report
       soter auth|mcp|models|...    passthrough to the pinned opencode
       soter --version`)
}

// ---- subcommands
if (sub === '--version' || sub === '-v') {
  console.log(`soter ${VERSION} (opencode-ai ${PIN})`)
  process.exit(0)
}

if (BLOCKED_SUBS.has(sub)) {
  console.error(`soter: '${sub}' is disabled — the OpenCode version is pinned by @soterlabs/soter (${PIN}); update Soter itself instead`)
  process.exit(1)
}

if (sub === 'check') {
  const rest = argvRaw.slice(1).length ? argvRaw.slice(1) : ['--all']
  // --root injection is mandatory: without it the vendored checker would scan the
  // installed package's own tree and exit clean on a red project.
  const r = spawnSync(process.execPath, [checker, ...rest, '--root', projectDir], { stdio: 'inherit' })
  process.exit(r.status ?? 1)
}

if (sub === 'init') {
  const rest = argvRaw.slice(1)
  const refresh = rest.includes('--refresh')
  const positional = rest.filter((a) => !a.startsWith('-'))
  const unknownFlags = rest.filter((a) => a.startsWith('-') && a !== '--refresh')
  if (unknownFlags.length) { console.error(`soter init: unknown option ${unknownFlags[0]}`); usage(); process.exit(1) }
  if (positional.length > 1) { console.error('soter init: at most one target directory'); usage(); process.exit(1) }
  const target = positional[0] ? path.resolve(positional[0]) : projectDir
  if (positional[0] && !isDir(target)) { console.error(`soter init: ${target} is not a directory`); process.exit(1) }
  const scaffold = path.join(CLI, 'dist', 'scaffold')
  if (!isDir(scaffold)) { console.error('soter init: package payload missing (dist/scaffold) — reinstall @soterlabs/soter'); process.exit(1) }
  let installed = 0, skipped = 0, refreshed = 0
  const refreshedFiles = []
  const walk = (src, dst) => {
    for (const e of readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, e.name), d = path.join(dst, e.name)
      if (e.isDirectory()) { mkdirSync(d, { recursive: true }); walk(s, d) }
      else if (existsSync(d)) {
        if (refresh && !readFileSync(s).equals(readFileSync(d))) {
          cpSync(s, d); refreshed++; refreshedFiles.push(path.relative(target, d))
        } else skipped++
      } else { mkdirSync(path.dirname(d), { recursive: true }); cpSync(s, d); installed++ }
    }
  }
  walk(scaffold, target)
  console.log(`soter init: ${installed} file(s) installed into ${target}, ${skipped} unchanged${refresh ? `, ${refreshed} refreshed` : ' (never overwritten; --refresh updates drifted scaffold files)'}`)
  if (refreshed) {
    for (const f of refreshedFiles.slice(0, 20)) console.log(dim(`  refreshed: ${f}`))
    console.log(dim('  Review with `git diff` — refresh overwrites scaffold-owned files, and git is the undo.'))
  }
  process.exit(0)
}

if (sub === 'skills') {
  const manifest = JSON.parse(readFileSync(path.join(CONFIG_DIR, 'skills-manifest.json'), 'utf8'))
  const promoted = manifest.filter((s) => s.status === 'promoted')
  const staged = manifest.filter((s) => s.status === 'staged')
  console.log(gold('\nSoter Skills') + dim(` · ${manifest.length} loaded (${promoted.length} proven, ${staged.length} staged)\n`))
  const show = (list, tag) => {
    for (const s of list) {
      const firstSentence = s.description.split(/(?<=\.)\s/)[0]
      console.log(`  ${aegean('/' + s.name)} ${tag ? dim(`[${tag}] `) : ''}${dim('(' + s.system + ')')}`)
      console.log(`    ${firstSentence}\n`)
    }
  }
  show(promoted, '')
  show(staged, 'staged')
  console.log(dim('  Invoke any skill as a /command inside a session. Staged skills are user-invoke\n  only until real use earns promotion. Create new ones with /forge.\n'))
  process.exit(0)
}

if (sub === 'doctor') {
  let failures = 0
  const ok = (b) => { if (!b) failures++; return b ? '✓' : '✗' }
  const shippedTheme = path.join(CONFIG_DIR, 'themes', 'soter.json')
  const userTheme = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'opencode', 'themes', 'soter.json')
  const themeDrift = existsSync(userTheme) && existsSync(shippedTheme)
    && readFileSync(userTheme, 'utf8') !== readFileSync(shippedTheme, 'utf8')
  const vendoredSkew = existsSync(projectChecker) && existsSync(VENDORED_CHECKER)
    && readFileSync(projectChecker, 'utf8') !== readFileSync(VENDORED_CHECKER, 'utf8')
  console.log(`soter ${VERSION} · opencode pin ${PIN}`)
  console.log(`  config dir: ${CONFIG_DIR}`)
  console.log(`  project root: ${projectDir}`)
  console.log(`${ok(existsSync(OPENCODE))} pinned opencode binary`)
  console.log(`${ok(existsSync(CONFIG_DIR))} bundled config payload`)
  console.log(`${ok(true)} checker in use: ${checker === projectChecker ? 'project (.claude/scripts/check.mjs)' : 'vendored'}`)
  if (vendoredSkew) console.log(`! project checker differs from vendored (project wins in-session; keep the pin fresh)`)
  if (themeDrift) console.log(`! user theme differs from shipped (user edits are kept; delete ${userTheme} to restore)`)
  console.log(`${ok(existsSync(path.join(projectDir, '.claude', 'templates')))} scaffold present in ${projectDir} (run \`soter init\` if ✗)`)
  console.log(`${ok(truecolor)} truecolor terminal (theme degrades without it)`)
  console.log(`${ok(existsSync(stateFile))} first-run complete`)
  const r = spawnSync(process.execPath, [checker, '--all', '--root', projectDir], { encoding: 'utf8' })
  console.log(`${ok(r.status === 0)} soter check --all ${r.status === 0 ? 'green' : 'RED'}`)
  if (r.status !== 0) console.log(dim((r.stdout || '').trim().split('\n').slice(-6).join('\n')))
  process.exit(failures ? 1 : 0)
}

if (sub === 'run') {
  const rest = argvRaw.slice(1)
  if (rest.includes('--auto') && !rest.includes('--i-know-what-auto-means')) {
    console.error('soter run: --auto auto-approves permissions and must never drive side-effecting skills\n(pushing-to-notion, updating-a-notion-page, capturing-*) unattended.\nPass --i-know-what-auto-means to proceed anyway.')
    process.exit(1)
  }
  execOpencode(['run', ...rest.filter((a) => a !== '--i-know-what-auto-means')])
}

if (['auth', 'mcp', 'models', 'attach', 'session', 'export', 'stats'].includes(sub)) {
  execOpencode(argvRaw) // passthrough with Soter env applied
}

// Anything else that looks like an unknown subcommand (a non-directory bare token
// with more args, or an unrecognized word) gets usage, not silent passthrough.
if (sub && !sub.startsWith('-') && !isDir(sub)) {
  console.error(`soter: unknown command '${sub}'`)
  usage()
  process.exit(1)
}

// ---- default: interactive TUI (optionally `soter <dir>`)
if (tty) {
  splash()
  if (!existsSync(stateFile)) {
    console.log(gold('  First run.') + ' Two things to know:\n')
    console.log('  1. Connect a model provider with ' + aegean('soter auth login') + ' (keys are stored by')
    console.log('     OpenCode\'s own auth store — Soter never touches a secret).')
    console.log('  2. This repo ' + (existsSync(path.join(projectDir, '.claude', 'templates')) ? 'already has' : 'lacks') + ' the harness scaffold — ' + aegean('soter init') + ' installs it.\n')
    try {
      mkdirSync(stateDir, { recursive: true })
      writeFileSync(stateFile, JSON.stringify({ firstRunAt: new Date().toISOString(), version: VERSION }, null, 2))
    } catch { /* an unwritable config dir must not block the session */ }
  }
}
execOpencode(argvRaw)
