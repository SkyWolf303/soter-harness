#!/usr/bin/env node
// soter — the harness as a product. Wraps a version-pinned OpenCode with the
// soter-harness content bridged in and the enforcement plugin armed.
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_DIR = path.join(CLI, 'dist', 'config')
const VENDORED_CHECKER = path.join(CLI, 'vendor', 'check.mjs')
const OPENCODE = path.join(CLI, 'node_modules', '.bin', 'opencode')
const VERSION = JSON.parse(readFileSync(path.join(CLI, 'package.json'), 'utf8')).version
const PIN = JSON.parse(readFileSync(path.join(CLI, 'package.json'), 'utf8')).dependencies['opencode-ai']

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

// ---- project + checker resolution
const argvRaw = process.argv.slice(2)
const sub = argvRaw[0]
const projectDir = (() => {
  const dirArg = ['run', 'check', 'init', 'doctor'].includes(sub) ? null : argvRaw.find((a) => !a.startsWith('-'))
  const base = dirArg && existsSync(dirArg) ? path.resolve(dirArg) : process.cwd()
  return base
})()
const projectChecker = path.join(projectDir, '.claude', 'scripts', 'check.mjs')
const checker = existsSync(projectChecker) ? projectChecker : VENDORED_CHECKER

const stateFile = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'soter', 'state.json')

const opencodeEnv = () => {
  const env = {
    ...process.env,
    OPENCODE_CONFIG: path.join(CONFIG_DIR, 'opencode.json'),
    OPENCODE_CONFIG_DIR: CONFIG_DIR,
    SOTER_CHECKER: checker,
    SOTER_ROOT: projectDir,
    SOTER_NODE: process.execPath, // the plugin runs under OpenCode's Bun; give it real node

  }
  // Load-exactly-once: repos with their own root CLAUDE.md use it (project-relative
  // instructions entry); fresh repos get the bundled product CLAUDE.md by absolute path.
  if (!existsSync(path.join(projectDir, 'CLAUDE.md')))
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ instructions: [path.join(CONFIG_DIR, 'CLAUDE.md')] })
  return env
}

// Theme fallback (spec open question 9): whether OPENCODE_CONFIG_DIR/themes is
// searched is unverified, so guarantee the theme by installing it into the user
// themes dir. Idempotent; overwrites only when the shipped theme changed.
const ensureTheme = () => {
  try {
    const src = path.join(CONFIG_DIR, 'themes', 'soter.json')
    const dstDir = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'opencode', 'themes')
    const dst = path.join(dstDir, 'soter.json')
    const body = readFileSync(src, 'utf8')
    if (!existsSync(dst) || readFileSync(dst, 'utf8') !== body) {
      mkdirSync(dstDir, { recursive: true })
      writeFileSync(dst, body)
    }
  } catch { /* cosmetic — never block launch */ }
}

const execOpencode = (args, opts = {}) => {
  if (process.platform === 'win32') { console.error('soter: Windows is not yet supported'); process.exit(1) }
  if (!existsSync(OPENCODE)) { console.error('soter: pinned opencode binary missing — run npm install in the soter package'); process.exit(1) }
  ensureTheme()
  const r = spawnSync(OPENCODE, args, { stdio: 'inherit', env: opencodeEnv(), ...opts })
  process.exit(r.status ?? 1)
}

// ---- subcommands
if (sub === '--version' || sub === '-v') {
  console.log(`soter ${VERSION} (opencode-ai ${PIN})`)
  process.exit(0)
}

if (sub === 'check') {
  const rest = argvRaw.slice(1).length ? argvRaw.slice(1) : ['--all']
  // --root injection is mandatory: without it the vendored checker would scan the
  // installed package's own tree and exit clean on a red project.
  const r = spawnSync(process.execPath, [checker, ...rest, '--root', projectDir], { stdio: 'inherit' })
  process.exit(r.status ?? 1)
}

if (sub === 'init') {
  const scaffold = path.join(CLI, 'dist', 'scaffold')
  let installed = 0, skipped = 0
  const walk = (src, dst) => {
    for (const e of readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, e.name), d = path.join(dst, e.name)
      if (e.isDirectory()) { mkdirSync(d, { recursive: true }); walk(s, d) }
      else if (existsSync(d)) skipped++
      else { mkdirSync(path.dirname(d), { recursive: true }); cpSync(s, d); installed++ }
    }
  }
  walk(scaffold, projectDir)
  console.log(`soter init: ${installed} file(s) installed, ${skipped} already present (never overwritten)`)
  process.exit(0)
}

if (sub === 'doctor') {
  const ok = (b) => (b ? '✓' : '✗')
  const vendoredSkew = existsSync(projectChecker) && existsSync(VENDORED_CHECKER)
    && readFileSync(projectChecker, 'utf8') !== readFileSync(VENDORED_CHECKER, 'utf8')
  console.log(`soter ${VERSION} · opencode pin ${PIN}`)
  console.log(`${ok(existsSync(OPENCODE))} pinned opencode binary`)
  console.log(`${ok(existsSync(CONFIG_DIR))} bundled config payload`)
  console.log(`${ok(true)} checker in use: ${checker === projectChecker ? 'project (.claude/scripts/check.mjs)' : 'vendored'}`)
  if (vendoredSkew) console.log(`! project checker differs from vendored (project wins in-session; keep the pin fresh)`)
  console.log(`${ok(existsSync(path.join(projectDir, '.claude', 'templates')))} scaffold present in ${projectDir} (run \`soter init\` if ✗)`)
  console.log(`${ok(truecolor)} truecolor terminal (theme degrades without it)`)
  console.log(`${ok(existsSync(stateFile))} first-run complete`)
  const r = spawnSync(process.execPath, [checker, '--all', '--root', projectDir], { encoding: 'utf8' })
  console.log(`${ok(r.status === 0)} soter check --all ${r.status === 0 ? 'green' : 'RED'}`)
  process.exit(0)
}

if (sub === 'run') {
  const rest = argvRaw.slice(1)
  if (rest.includes('--auto') && !rest.includes('--i-know-what-auto-means')) {
    console.error('soter run: --auto auto-approves permissions and must never drive side-effecting guides\n(pushing-to-notion, updating-a-notion-page, capturing-*) unattended.\nPass --i-know-what-auto-means to proceed anyway.')
    process.exit(1)
  }
  execOpencode(['run', ...rest.filter((a) => a !== '--i-know-what-auto-means')])
}

if (sub === 'auth' || sub === 'mcp' || sub === 'models') {
  execOpencode(argvRaw) // passthrough with Soter env applied
}

// ---- default: interactive TUI
if (tty) {
  splash()
  if (!existsSync(stateFile)) {
    console.log(gold('  First run.') + ' Two things to know:\n')
    console.log('  1. Connect a model provider with ' + aegean('soter auth login') + ' (keys are stored by')
    console.log('     OpenCode\'s own auth store — Soter never touches a secret).')
    console.log('  2. This repo ' + (existsSync(path.join(projectDir, '.claude', 'templates')) ? 'already has' : 'lacks') + ' the harness scaffold — ' + aegean('soter init') + ' installs it.\n')
    mkdirSync(path.dirname(stateFile), { recursive: true })
    writeFileSync(stateFile, JSON.stringify({ firstRunAt: new Date().toISOString(), version: VERSION }, null, 2))
  }
}
execOpencode(argvRaw)
