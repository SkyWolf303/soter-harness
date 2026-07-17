// Adapter tests: fire OpenCode-shaped hook calls at the enforcement plugin and
// assert the checker's verdicts translate correctly. Runs cold: without
// SOTER_TEST_REPO it bootstraps a scaffolded scratch repo in a temp dir.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SoterEnforcement } from '../assets/plugins/soter-enforcement.js'

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = process.env.SOTER_TEST_REPO || (() => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'soter-test-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync(process.execPath, [path.join(CLI, 'bin', 'soter.mjs'), 'init', dir], { cwd: dir })
  return dir
})()

const prompts = []
const client = { session: { prompt: async (o) => { prompts.push(o); return {} } } }
const hooks = await SoterEnforcement({ client, directory: REPO })

test('E1: force-push is blocked with the checker reason', async () => {
  await assert.rejects(
    hooks['tool.execute.before']({ tool: 'bash', sessionID: 's1', callID: 'c1' }, { args: { command: 'git push --force origin main' } }),
    (e) => e.message.length > 0,
  )
})

test('E1: benign command passes', async () => {
  await hooks['tool.execute.before']({ tool: 'bash', sessionID: 's1', callID: 'c2' }, { args: { command: 'ls -la' } })
})

test('E1: workdir (OpenCode bash arg name) is honored', async () => {
  // must not throw on a benign command with workdir set — and must still block a
  // guarded command regardless of workdir
  await hooks['tool.execute.before']({ tool: 'bash', sessionID: 's1', callID: 'c2b' }, { args: { command: 'ls', workdir: REPO } })
  await assert.rejects(
    hooks['tool.execute.before']({ tool: 'bash', sessionID: 's1', callID: 'c2c' }, { args: { command: 'git push --force origin main', workdir: REPO } }),
  )
})

test('E1: editing an Accepted ADR is blocked (camelCase args)', async () => {
  const adr = path.join(REPO, 'decisions', 'ADR-0001-test.md')
  mkdirSync(path.dirname(adr), { recursive: true })
  writeFileSync(adr, '# ADR-0001: test\n\n- **Status:** Accepted\n- **Date:** 2026-07-16\n\n## Context\nx\n\n## Decision\nx\n\n## Consequences\nx\n')
  await assert.rejects(
    hooks['tool.execute.before']({ tool: 'edit', sessionID: 's1', callID: 'c3' }, { args: { filePath: adr, oldString: 'x', newString: 'y' } }),
  )
})

test('E1: apply_patch touching an Accepted ADR is blocked (patch bypass regression)', async () => {
  const adr = path.join(REPO, 'decisions', 'ADR-0001-test.md')
  const patchText = '*** Begin Patch\n*** Update File: ' + adr + '\n@@\n-x\n+y\n*** End Patch\n'
  await assert.rejects(
    hooks['tool.execute.before']({ tool: 'apply_patch', sessionID: 's1', callID: 'c3b' }, { args: { patchText } }),
  )
})

test('E2: a violating write gets the report appended to tool output', async () => {
  const bad = path.join(REPO, '.claude', 'skills', 'bad-skill', 'SKILL.md')
  mkdirSync(path.dirname(bad), { recursive: true })
  writeFileSync(bad, '# no frontmatter at all\n')
  const output = { title: '', output: 'wrote file', metadata: {} }
  await hooks['tool.execute.after']({ tool: 'write', sessionID: 's1', callID: 'c4', args: { filePath: bad } }, output)
  assert.ok(output.output.length > 'wrote file'.length, 'report should be appended')
  rmSync(path.dirname(bad), { recursive: true, force: true })
})

test('E3: compaction hook pushes where-am-I context', async () => {
  const output = { context: [] }
  await hooks['experimental.session.compacting']({ sessionID: 's1' }, output)
  assert.ok(output.context.length === 1 && /branch|worktree|checkout/i.test(output.context[0]))
})

test('identity: system transform injects Soter identity', async () => {
  const output = { system: [] }
  await hooks['experimental.chat.system.transform']({ model: {} }, output)
  assert.equal(output.system.length, 1)
  assert.match(output.system[0], /You are Soter/)
})

test('E4: red repo gates once; own re-prompt echo never re-arms (loop regression); real user turn does', async () => {
  const bad = path.join(REPO, '.claude', 'skills', 'bad-skill', 'SKILL.md')
  mkdirSync(path.dirname(bad), { recursive: true })
  writeFileSync(bad, '# no frontmatter\n')
  prompts.length = 0
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's9' } } })
  assert.equal(prompts.length, 1, 'first idle on red repo re-prompts')
  assert.match(prompts[0].body.parts[0].text, /TURN GATE/)
  // the SDK prompt lands as a user-role message — this echo must NOT re-arm
  await hooks.event({ event: { type: 'message.updated', properties: { info: { role: 'user', sessionID: 's9' } } } })
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's9' } } })
  assert.equal(prompts.length, 1, 'own echo does not re-arm — no infinite gate loop')
  // a REAL user message re-arms
  await hooks.event({ event: { type: 'message.updated', properties: { info: { role: 'user', sessionID: 's9' } } } })
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's9' } } })
  assert.equal(prompts.length, 2, 'real user turn re-arms the gate')
  rmSync(path.dirname(bad), { recursive: true, force: true })
})

test('E4: green repo on session.idle stays silent and stays armed', async () => {
  prompts.length = 0
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's10' } } })
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's10' } } })
  assert.equal(prompts.length, 0)
})
