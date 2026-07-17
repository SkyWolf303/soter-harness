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
const GATE_TIMEOUT_MS = 30000 // --gate runs checkAll over the whole repo — needs headroom
const GATE_MAX_VIOLATION_LINES = 12
const GATE_PROMPT_PREFIX = 'TURN GATE: the harness checker reports error-level violations.'

const debug = (...a) => { if (process.env.SOTER_DEBUG) console.error('[soter]', ...a) }

// Tool-id classification. OpenCode's built-in ids are lowercase ("bash", "edit",
// "write", "apply_patch"); match loosely so renames degrade to fail-open, never crash.
const isBashTool = (t) => /bash|shell/i.test(t)
const isEditTool = (t) => /edit/i.test(t)
const isWriteTool = (t) => /write/i.test(t)
const isPatchTool = (t) => /patch/i.test(t)

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

// apply_patch carries a whole patch document; extract every touched file path so
// each gets its own guard verdict (otherwise patch writes bypass E1/E2 entirely).
const patchFilePaths = (args) => {
  const text = args?.patchText ?? args?.patch ?? args?.input ?? ''
  if (typeof text !== 'string' || !text) return []
  const out = []
  const re = /^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(.+)\s*$/gm
  let m
  while ((m = re.exec(text)) !== null) out.push(m[1].trim())
  return out
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

const runChecker = (checker, mode, root, stdinObj, timeoutMs = SPAWN_TIMEOUT_MS) => new Promise((resolve) => {
  const child = spawn(NODE, [checker, mode, '--root', root], {
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: timeoutMs,
  })
  let stdout = '', stderr = ''
  child.stdout.on('data', (d) => { stdout += d })
  child.stderr.on('data', (d) => { stderr += d })
  child.on('error', (err) => resolve({ code: null, stdout, stderr, err })) // spawn failure -> fail open
  child.on('close', (code) => resolve({ code, stdout, stderr }))
  child.stdin.end(JSON.stringify(stdinObj))
})

// A computed block. Thrown OUTSIDE any try/catch of ours: the throw decision must
// never depend on message content (a filter once swallowed a real verdict whose
// text lacked the expected tokens — fail-open on the one non-open path).
const blockError = (stderr, fallback) => new Error((stderr || '').trim() || fallback)

export const SoterEnforcement = async ({ client, directory }) => {
  const root = process.env.SOTER_ROOT || directory
  const checker = resolveChecker(root)
  if (!checker) {
    debug('no checker found; enforcement disabled (off-harness, no vendored copy)')
    return {}
  }
  debug('checker:', checker, 'root:', root)

  // E4 state, per session. armed: a red gate may re-prompt once per turn; a real
  // user turn re-arms; green re-arms. selfPromptsPending counts our own SDK
  // re-prompts so the resulting message.updated (role user!) does NOT re-arm —
  // otherwise the gate re-arms itself and loops forever on a persistently red repo.
  const gate = new Map() // sessionID -> { armed: boolean, selfPromptsPending: number }
  const gateState = (id) => {
    if (!gate.has(id)) gate.set(id, { armed: true, selfPromptsPending: 0 })
    return gate.get(id)
  }

  return {
    // E1 — pre-execution guard. Verdict computed inside try (fail open on internal
    // error); the block itself is thrown OUTSIDE the catch and is unconditional.
    'tool.execute.before': async (input, output) => {
      const args = output.args ?? {}
      debug('tool.execute.before:', input.tool, 'args keys:', Object.keys(args).join(','))
      let verdicts = [] // {code, stderr}
      try {
        if (isBashTool(input.tool)) {
          const command = args.command
          if (typeof command !== 'string') return debug('guard-bash: no command in args for', input.tool)
          // OpenCode's bash tool names its working dir `workdir` (older shapes: cwd)
          const cwd = args.workdir ?? args.cwd ?? root
          verdicts.push(await runChecker(checker, '--guard-bash', root, { cwd, tool_input: { command } }))
        } else if (isWriteTool(input.tool) || isEditTool(input.tool)) {
          const tool_input = normalizeWriteArgs(args)
          if (!tool_input) return debug('guard-write: unrecognized args shape for', input.tool)
          verdicts.push(await runChecker(checker, '--guard-write', root, { cwd: root, tool_input }))
        } else if (isPatchTool(input.tool)) {
          const paths = patchFilePaths(args)
          if (!paths.length) return debug('guard-write(patch): no file paths extracted for', input.tool)
          for (const p of paths) {
            verdicts.push(await runChecker(checker, '--guard-write', root, {
              cwd: root,
              tool_input: { file_path: p, old_string: '(patch)', new_string: '(patch)' },
            }))
          }
        }
      } catch (e) {
        debug('E1 internal error (fail open):', e.message)
        return
      }
      for (const r of verdicts) {
        if (r.code === 2) throw blockError(r.stderr, 'soter: blocked by the harness guard')
        if (r.err) debug('E1 spawn error (fail open):', r.err.message)
      }
    },

    // E2 — post-write check. Warn-only; report appended to the tool result so
    // the model sees violations inline.
    'tool.execute.after': async (input, output) => {
      try {
        let paths = []
        if (isWriteTool(input.tool) || isEditTool(input.tool)) {
          const p = filePathOf(input.args)
          if (p) paths = [p]
        } else if (isPatchTool(input.tool)) {
          paths = patchFilePaths(input.args)
        }
        for (const file_path of paths) {
          const r = await runChecker(checker, '--hook', root, { cwd: root, tool_input: { file_path } })
          const report = (r.stdout || '').trim()
          if (report) output.output = (output.output ? output.output + '\n\n' : '') + report
        }
      } catch (e) { debug('E2 error (skip):', e.message) }
    },

    // Product identity — the model is Soter, whatever chassis or repo it wakes in.
    'experimental.chat.system.transform': async (_input, output) => {
      output.system.push(`# You are Soter

Soter is the soter-harness shipped as a standalone product: an agent operating system, not a bare assistant. Tagline: "nothing goes unguarded."

WHY YOU EXIST: teams teach their agents the same things over and over, and the knowledge evaporates. The harness makes that context durable and enforced — every concept is defined once (the LEXICON), every piece is born from a mold, meets one quality bar (the RUBRIC), proves itself with evals, and passes a human gate before it lands. You are the agent those rules govern.

WHAT GUARDS YOU: the harness checker verifies your work mechanically — shell commands are guarded before they run, writes are linted after they land, and a red repo holds your turn open. A BLOCKED verdict is absolute; fix the cause, never route around it.

SOTER SKILLS: your structured workflows are Soter Skills — /commands backed by the harness, each born through the forge (mold, evals, pressure test, human gate) and promoted only by real use. The system grows them deliberately: (1) when you notice a recurring workflow, a knowledge gap you couldn't answer, or a repeated correction, SUGGEST forging a skill for it — name the territory and offer /forge; never forge unasked. (2) When the user corrects you, offer to land the correction durably — a gotcha on the governing skill, an eval case, or an ADR — an uncaptured correction recurs. Running "soter skills" in a terminal lists what's loaded.

IDENTITY HONESTY: when asked who you are, answer as Soter — built by Soter Labs on the soter-harness, running on the OpenCode runtime. The underlying model is whichever provider the user connected; never claim a specific model vendor or training provenance unless it is visible in your context.`)
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
          const s = gateState(event.properties.info.sessionID)
          if (s.selfPromptsPending > 0) {
            s.selfPromptsPending-- // our own re-prompt echoing back — never re-arms
            return
          }
          s.armed = true // real user turn boundary: re-arm
          return
        }
        if (event.type !== 'session.idle') return
        const sessionID = event.properties?.sessionID
        if (!sessionID) return
        const s = gateState(sessionID)
        if (!s.armed) return // blocked once this turn already — stand down
        s.armed = false // disarm BEFORE the await: concurrent idles must not double-fire
        const r = await runChecker(checker, '--gate', root, { stop_hook_active: false, cwd: root }, GATE_TIMEOUT_MS)
        if (r.code !== 2) { s.armed = true; return } // green or fail-open: nothing to hold, stay armed
        const lines = r.stderr.trim().split('\n').slice(0, GATE_MAX_VIOLATION_LINES).join('\n')
        debug('E4 gate red; re-prompting', sessionID)
        s.selfPromptsPending++
        try {
          await client.session.prompt({
            path: { id: sessionID },
            body: { parts: [{ type: 'text', text: GATE_PROMPT_PREFIX + ' Fix them before finishing:\n\n' + lines }] },
          })
        } catch (e) {
          s.selfPromptsPending-- // prompt never landed; no echo coming
          throw e
        }
      } catch (e) { debug('E4 error (skip):', e.message) }
    },
  }
}
