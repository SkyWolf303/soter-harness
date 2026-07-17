// Adapter tests: fire OpenCode-shaped hook calls at the enforcement plugin and
// assert the checker's verdicts translate correctly. Uses a scaffolded scratch
// repo (SOTER_TEST_REPO) as the project.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { SoterEnforcement } from '../assets/plugins/soter-enforcement.js'

const REPO = process.env.SOTER_TEST_REPO
if (!REPO) throw new Error('set SOTER_TEST_REPO to a scaffolded scratch repo')

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

test('E1: editing an Accepted ADR is blocked (camelCase args)', async () => {
  const adr = path.join(REPO, 'decisions', 'ADR-0001-test.md')
  writeFileSync(adr, '# ADR-0001: test\n\n- **Status:** Accepted\n- **Date:** 2026-07-16\n\n## Context\nx\n\n## Decision\nx\n\n## Consequences\nx\n')
  await assert.rejects(
    hooks['tool.execute.before']({ tool: 'edit', sessionID: 's1', callID: 'c3' }, { args: { filePath: adr, oldString: 'x', newString: 'y' } }),
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

test('E4: red repo on session.idle triggers one gate re-prompt, then stands down until user turn', async () => {
  const bad = path.join(REPO, '.claude', 'skills', 'bad-skill', 'SKILL.md')
  mkdirSync(path.dirname(bad), { recursive: true })
  writeFileSync(bad, '# no frontmatter\n')
  prompts.length = 0
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's9' } } })
  assert.equal(prompts.length, 1, 'first idle on red repo re-prompts')
  assert.match(prompts[0].body.parts[0].text, /TURN GATE/)
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's9' } } })
  assert.equal(prompts.length, 1, 'second idle same turn stands down (blocks once)')
  await hooks.event({ event: { type: 'message.updated', properties: { info: { role: 'user', sessionID: 's9' } } } })
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's9' } } })
  assert.equal(prompts.length, 2, 'user turn re-arms the gate')
  rmSync(path.dirname(bad), { recursive: true, force: true })
})

test('identity: system transform injects Soter identity', async () => {
  const output = { system: [] }
  await hooks['experimental.chat.system.transform']({ model: {} }, output)
  assert.equal(output.system.length, 1)
  assert.match(output.system[0], /You are Soter/)
})

test('E4: green repo on session.idle stays silent', async () => {
  prompts.length = 0
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's10' } } })
  assert.equal(prompts.length, 0)
})
