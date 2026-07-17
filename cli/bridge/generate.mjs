// Content bridge — one-way, build-time, deterministic.
// Reads the soter-harness source tree (repo root two dirs up) and emits:
//   dist/config/     opencode.json, CLAUDE.md, commands/*.md, plugins/, themes/, tui.json
//   dist/scaffold/   the on-repo assets `soter init` installs
//   vendor/check.mjs the checker, byte-identical to .claude/scripts/check.mjs
// Hand-editing dist/ is forbidden; regenerate instead (CI diff-checks this).
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = path.resolve(CLI, '..')
// In the harness repo layout cli/ sits at the repo root; inside a worktree the
// same relative shape holds. Sanity-check we found the harness.
if (!existsSync(path.join(REPO, '.claude', 'scripts', 'check.mjs')))
  throw new Error(`bridge: cannot find harness source at ${REPO}`)

const OUT = path.join(CLI, 'dist')
rmSync(OUT, { recursive: true, force: true })
const cfg = (...p) => path.join(OUT, 'config', ...p)
mkdirSync(cfg('commands'), { recursive: true })
mkdirSync(cfg('plugins'), { recursive: true })
mkdirSync(cfg('themes'), { recursive: true })
mkdirSync(path.join(OUT, 'scaffold'), { recursive: true })
mkdirSync(path.join(CLI, 'vendor'), { recursive: true })

// ---- minimal YAML frontmatter parser (key: value, and `key: >-` folded blocks)
const parseFrontmatter = (src) => {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return { fields: {}, body: src }
  const fields = {}
  const lines = m[1].split('\n')
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([\w-]+):\s*(.*)$/)
    if (!kv) continue
    let [, key, val] = kv
    if (val === '>-' || val === '>' || val === '|') {
      const block = []
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) block.push(lines[++i].trim())
      val = block.join(' ')
    }
    fields[key] = val
  }
  return { fields, body: src.slice(m[0].length) }
}

// ---- CLAUDE.md -> product instructions: source verbatim, plus a generated
// runtime appendix. The appendix restates the harness's own staged-guide rule
// (authoring.md: "a staged piece still governs when the user explicitly asks for
// its work") — without it, sessions can't know unpromoted guides exist, since the
// guide index lists promoted pieces only (observed live: a Sky-ecosystem question
// went unanswered while the governing staged guide sat on disk).
const RUNTIME_NOTES = `

## Soter runtime notes (generated — not in the source CLAUDE.md)

- The guide index above lists PROMOTED guides only. ALL guides — staged included —
  are available as /commands and live in \`.claude/skills/<name>/SKILL.md\`. When a
  user request matches a guide's territory, read its SKILL.md and follow it: the
  staged flag gates auto-invocation, not user-requested work.
- Domain vocabulary (including the Sky ecosystem) is defined in \`.claude/LEXICON.md\`
  — consult it before answering domain questions, and never redefine its terms.
`
writeFileSync(cfg('CLAUDE.md'), readFileSync(path.join(REPO, 'CLAUDE.md'), 'utf8') + RUNTIME_NOTES)

// ---- skills -> commands
const skillsDir = path.join(REPO, '.claude', 'skills')
let generated = 0, held = 0
for (const name of readdirSync(skillsDir).sort()) {
  const skillPath = path.join(skillsDir, name, 'SKILL.md')
  if (!existsSync(skillPath)) continue
  const { fields, body } = parseFrontmatter(readFileSync(skillPath, 'utf8'))
  if (fields['promotion-hold']) { held++; continue } // held = not shipped
  let outBody = body
  // sibling files travel to skill-assets/<name>/ (NOT commands/ — every .md there
  // would become a command); bare references in the body are rewritten
  const siblings = readdirSync(path.join(skillsDir, name)).filter((f) => f !== 'SKILL.md')
  if (siblings.length) {
    mkdirSync(cfg('skill-assets', name), { recursive: true })
    for (const f of siblings) {
      cpSync(path.join(skillsDir, name, f), cfg('skill-assets', name, f))
      outBody = outBody.split(f).join(`skill-assets/${name}/${f} (relative to the Soter config dir; ask \`soter doctor\` for its location)`)
    }
  }
  const desc = (fields.description || '').replace(/"/g, '\\"')
  writeFileSync(cfg('commands', `${name}.md`), `---\ndescription: "${desc}"\n---\n${outBody}`)
  generated++
}

// ---- .mcp.json -> opencode.json mcp block
const mcpSrc = JSON.parse(readFileSync(path.join(REPO, '.claude', '.mcp.json'), 'utf8')).mcpServers ?? {}
const mcp = {}
for (const [name, s] of Object.entries(mcpSrc)) {
  mcp[name] = s.type === 'stdio'
    ? { type: 'local', command: [s.command, ...(s.args ?? [])], enabled: true, environment: s.env ?? undefined }
    : { type: 'remote', url: s.url, enabled: true, headers: s.headers ?? undefined }
}

// ---- opencode.json (instructions entry is project-relative; the launcher swaps
// in the bundled CLAUDE.md via OPENCODE_CONFIG_CONTENT on repos that lack one)
writeFileSync(cfg('opencode.json'), JSON.stringify({
  $schema: 'https://opencode.ai/config.json',
  theme: 'soter',
  instructions: ['CLAUDE.md'],
  mcp,
}, null, 2) + '\n')

// ---- static assets
cpSync(path.join(CLI, 'assets', 'plugins', 'soter-enforcement.js'), cfg('plugins', 'soter-enforcement.js'))
cpSync(path.join(CLI, 'assets', 'themes', 'soter.json'), cfg('themes', 'soter.json'))
cpSync(path.join(CLI, 'assets', 'tui.json'), cfg('tui.json'))
cpSync(path.join(CLI, 'assets', 'commands', 'about.md'), cfg('commands', 'about.md'))

// ---- vendor the checker, byte-identical
cpSync(path.join(REPO, '.claude', 'scripts', 'check.mjs'), path.join(CLI, 'vendor', 'check.mjs'))

// ---- scaffold: what `soter init` installs into a fresh repo. The full kernel —
// partial scaffolds leave the checker structurally red (SYSTEM_UNKNOWN etc.);
// the complete tree is green by construction, with golden stamps degrading to
// warnings on a repo without the source git history.
const scaf = (...p) => path.join(OUT, 'scaffold', ...p)
const claudeSrc = path.join(REPO, '.claude')
cpSync(claudeSrc, scaf('.claude'), {
  recursive: true,
  // test the path RELATIVE to .claude/ — the absolute path may itself contain
  // /worktrees/ when the bridge runs inside a git worktree checkout
  filter: (src) => !/^worktrees(\/|$)/.test(path.relative(claudeSrc, src)),
})
cpSync(path.join(REPO, 'CLAUDE.md'), scaf('CLAUDE.md'))
mkdirSync(scaf('decisions'), { recursive: true })
writeFileSync(scaf('decisions', 'README.md'), '# Decisions\n\nADRs live here — one file per durable decision, numbered ADR-0001 upward.\nRecord decisions with `/writing-adrs`.\n')

console.log(`bridge: ${generated} commands generated, ${held} held back, mcp servers: ${Object.keys(mcp).join(', ') || 'none'}`)
