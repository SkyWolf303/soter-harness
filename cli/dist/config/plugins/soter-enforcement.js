// soter-enforcement — the OpenCode adapter for the harness enforcement contract.
// Translates OpenCode plugin hooks into the stdin-JSON contracts check.mjs already
// speaks, and translates exit codes back. Fail open everywhere except a
// successfully computed block (check.mjs exit 2). See the design spec, and the
// enforcement contract: E1 pre-exec guard, E2 post-write check, E3 session
// context, E4 turn gate (workaround: session.idle + SDK re-prompt).
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SPAWN_TIMEOUT_MS = 5000
const GATE_MAX_VIOLATION_LINES = 12

const debug = (...a) => { if (process.env.SOTER_DEBUG) console.error('[soter]', ...a) }

// Tool-id classification. OpenCode's built-in ids are lowercase ("bash", "edit",
// "write", "patch"); match loosely so renames degrade to fail-open, never crash.
const isBashTool = (t) => /bash|shell/i.test(t)
const isEditTool = (t) => /edit|patch/i.test(t)
const isWriteTool = (t) => /write/i.test(t)

// Args normalization: OpenCode args are camelCase; check.mjs speaks snake_case.
const filePathOf = (args) => args?.filePath ?? args?.file_path ?? args?.path ?? null
const normalizeWriteArgs = (args) => {
  const file_path = filePathOf(args)
  if (!file_path) return null
  const ti = { file_path }
  if (args.content !== undefined) ti.content = args.content
  const oldS = args.oldString ?? args.old_string
  const newS = args.newString ?? args.new_string
  if (oldS !== undefined) ti.old_string = oldS
  if (newS !== undefined) ti.new_string = newS
  const ra = args.replaceAll ?? args.replace_all
  if (ra !== undefined) ti.replace_all = ra
  return ti
}

const resolveChecker = (projectDir) => {
  const own = path.join(projectDir, '.claude', 'scripts', 'check.mjs')
  if (existsSync(own)) return own // project checker is the merge authority
  if (process.env.SOTER_CHECKER && existsSync(process.env.SOTER_CHECKER)) return process.env.SOTER_CHECKER
  const vendored = path.resolve(HERE, '..', '..', '..', 'vendor', 'check.mjs')
  return existsSync(vendored) ? vendored : null
}

// Inside OpenCode's plugin runtime process.execPath is the opencode binary
// itself (embedded Bun), NOT node — the launcher passes the real node via
// SOTER_NODE; standalone plugin use falls back to PATH.
const NODE = process.env.SOTER_NODE || 'node'

const runChecker = (checker, mode, root, stdinObj) => new Promise((resolve) => {
  const child = spawn(NODE, [checker, mode, '--root', root], {
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: SPAWN_TIMEOUT_MS,
  })
  let stdout = '', stderr = ''
  child.stdout.on('data', (d) => { stdout += d })
  child.stderr.on('data', (d) => { stderr += d })
  child.on('error', (err) => resolve({ code: null, stdout, stderr, err })) // spawn failure -> fail open
  child.on('close', (code) => resolve({ code, stdout, stderr }))
  child.stdin.end(JSON.stringify(stdinObj))
})

export const SoterEnforcement = async ({ client, directory }) => {
  const root = process.env.SOTER_ROOT || directory
  const checker = resolveChecker(root)
  if (!checker) {
    debug('no checker found; enforcement disabled (off-harness, no vendored copy)')
    return {}
  }
  debug('checker:', checker, 'root:', root)

  // E4 state, per session: armed -> a red gate may re-prompt once; a user turn
  // re-arms; a green gate clears the block. Restores ADR-0035 per-turn semantics.
  const gate = new Map() // sessionID -> { armed: boolean }
  const gateState = (id) => { if (!gate.has(id)) gate.set(id, { armed: true }); return gate.get(id) }

  return {
    // E1 — pre-execution guard. A computed block is absolute; throwing blocks
    // the tool call and surfaces the checker's reason to the model.
    'tool.execute.before': async (input, output) => {
      try {
        const args = output.args ?? {}
        debug('tool.execute.before:', input.tool, 'args keys:', Object.keys(args).join(','))
        if (isBashTool(input.tool)) {
          const command = args.command
          if (typeof command !== 'string') return debug('guard-bash: no command in args for', input.tool)
          const r = await runChecker(checker, '--guard-bash', root, { cwd: args.cwd ?? root, tool_input: { command } })
          debug('guard-bash result: code', r.code, r.err ? 'spawn-err ' + r.err.message : '', (r.stderr || '').slice(0, 60))
          if (r.code === 2) throw new Error(r.stderr.trim() || 'soter: command blocked by the harness guard')
        } else if (isWriteTool(input.tool) || isEditTool(input.tool)) {
          const tool_input = normalizeWriteArgs(args)
          if (!tool_input) return debug('guard-write: unrecognized args shape for', input.tool)
          const r = await runChecker(checker, '--guard-write', root, { cwd: root, tool_input })
          if (r.code === 2) throw new Error(r.stderr.trim() || 'soter: write blocked by the harness guard')
        }
      } catch (e) {
        if (e instanceof Error && /blocked|NEVER|ADR/.test(e.message)) throw e // the one non-open path
        debug('E1 internal error (fail open):', e.message)
      }
    },

    // E2 — post-write check. Warn-only; report appended to the tool result so
    // the model sees violations inline.
    'tool.execute.after': async (input, output) => {
      try {
        if (!(isWriteTool(input.tool) || isEditTool(input.tool))) return
        const file_path = filePathOf(input.args)
        if (!file_path) return
        const r = await runChecker(checker, '--hook', root, { cwd: root, tool_input: { file_path } })
        const report = (r.stdout || '').trim()
        if (report) output.output = (output.output ? output.output + '\n\n' : '') + report
      } catch (e) { debug('E2 error (skip):', e.message) }
    },

    // Product identity — the model is Soter, whatever chassis or repo it wakes in.
    'experimental.chat.system.transform': async (_input, output) => {
      output.system.push('You are Soter, the guarded harness agent (built on OpenCode). Nothing goes unguarded: your writes and commands are checked by the harness checker, and its BLOCKED verdicts are absolute. When asked who or what you are, answer as Soter. Harness rules and guides come from the loaded instructions.')
    },

    // E3 — session context at compaction (the contract point).
    'experimental.session.compacting': async (_input, output) => {
      try {
        const r = await runChecker(checker, '--session-start', root, { cwd: root })
        const ctx = JSON.parse(r.stdout || 'null')?.hookSpecificOutput?.additionalContext
        if (ctx) output.context.push(ctx)
      } catch (e) { debug('E3 error (skip):', e.message) }
    },

    // E4 — turn-gate workaround: on idle, run --gate; red -> one SDK re-prompt.
    event: async ({ event }) => {
      try {
        if (event.type === 'message.updated' && event.properties?.info?.role === 'user') {
          gateState(event.properties.info.sessionID).armed = true // turn boundary: re-arm
          return
        }
        if (event.type !== 'session.idle') return
        const sessionID = event.properties?.sessionID
        if (!sessionID) return
        const s = gateState(sessionID)
        if (!s.armed) return // blocked once this turn already — stand down
        const r = await runChecker(checker, '--gate', root, { stop_hook_active: false, cwd: root })
        if (r.code !== 2) return // green (or fail-open): nothing to hold
        s.armed = false
        const lines = r.stderr.trim().split('\n').slice(0, GATE_MAX_VIOLATION_LINES).join('\n')
        debug('E4 gate red; re-prompting', sessionID)
        await client.session.prompt({
          path: { id: sessionID },
          body: { parts: [{ type: 'text', text: 'TURN GATE: the harness checker reports error-level violations. Fix them before finishing:\n\n' + lines }] },
        })
      } catch (e) { debug('E4 error (skip):', e.message) }
    },
  }
}
