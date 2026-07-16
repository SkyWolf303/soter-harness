import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createFixtureRuntimeState,
  evaluateEffectPolicy,
  invokeCapability
} from './capabilities.mjs';
import { assembleMeetingIntakeContext } from './context.mjs';
import { runConnectedDoctor, runOfflineDoctor } from './doctor.mjs';
import {
  createContextAssemblyEvidence,
  createContainedTransactionEvidence,
  createResolutionEvidence,
  createRunPreparationEvidence
} from './evidence.mjs';
import { fingerprintLock, resolveConfiguration } from './resolve.mjs';
import { prepareRunEnvelope } from './run.mjs';
import {
  completeHostToolCall,
  failHostToolCall,
  prepareHostToolCall
} from './host-tools.mjs';
import { fingerprintJson, readJson, writeJson } from './lib/canonical-json.mjs';
import { verifySoter } from '../kernel/verify.mjs';
import {
  approveChangeSet,
  changeSetScopeFingerprint,
  executeContainedChangeSet,
  proposeMeetingIntakeChangeSet,
  runContainedMeetingIntakeTransaction
} from './transaction.mjs';

const FIXTURE_TIME = '2026-07-15T12:00:00.000Z';

function installSelftestConnectedProvider(root, sourceId, targetId) {
  const sourcePath = path.join(root, 'soter/providers/' + sourceId + '.json');
  const provider = structuredClone(readJson(sourcePath));
  provider.id = targetId;
  provider.containment = 'connected';
  const server = provider.pack === 'integration.notion' ? 'notion' : 'otter';
  provider.runtime = {
    engine: 'mcp',
    module: provider.runtime.module,
    prepareExport: 'prepareMcp',
    completeExport: 'completeMcp',
    server,
    tools: server === 'notion'
      ? ['query_data_sources', 'create_pages', 'update_page']
      : ['fetch']
  };
  provider.fixtures = [];
  provider.limitations = [
    'Selftest-only connected declaration used to validate probe aggregation without credentials or network access.'
  ];
  const relativePath = 'soter/providers/' + targetId + '.json';
  writeJson(path.join(root, relativePath), provider);
  const packPath = path.join(root, 'soter/packs', provider.pack, 'pack.json');
  const pack = readJson(packPath);
  pack.artifacts.push({ path: relativePath, role: 'implementation' });
  writeJson(packPath, pack);
  return provider;
}

function selftestProviderProbes(lock, providers) {
  const base = {
    $contract: 'soter://contracts/provider-probe/v1',
    contractVersion: '1.0.0',
    probedAt: '2026-07-15T11:55:00.000Z',
    validUntil: '2026-07-15T12:05:00.000Z',
    configuration: {
      name: lock.configuration.name,
      lockFingerprint: fingerprintLock(lock)
    },
    reachability: {
      state: 'passed',
      details: 'Injected selftest transport responded without making a network request.',
      latencyMs: 0
    },
    secretValuesExcluded: true,
    limitations: [
      'Selftest observations prove Core aggregation behavior only, not a live provider connection.'
    ]
  };
  return [
    {
      ...structuredClone(base),
      id: 'probe.integration.notion.connected-selftest',
      provider: {
        pack: providers.notion.pack,
        implementation: providers.notion.id,
        version: providers.notion.version,
        containment: 'connected'
      },
      credentials: [
        {
          secretRefId: 'secret-ref.notion',
          state: 'passed',
          details: 'The injected resolver reported an authenticated Notion identity.'
        }
      ],
      authorities: [
        {
          id: 'authority.crm.definition',
          state: 'passed',
          details: 'The configured CRM definition authority was visible.'
        },
        {
          id: 'authority.crm.instance',
          state: 'passed',
          details: 'The configured CRM instance authority was visible.'
        }
      ],
      capabilities: [
        {
          id: 'crm.records.read',
          state: 'passed',
          method: 'read-only',
          details: 'A schema-compatible read-only response was observed.'
        },
        {
          id: 'crm.records.create',
          state: 'passed',
          method: 'permission-introspection',
          details: 'Required create permissions were reported without creating a record.'
        },
        {
          id: 'crm.records.update',
          state: 'passed',
          method: 'permission-introspection',
          details: 'Required update permissions were reported without updating a record.'
        }
      ]
    },
    {
      ...structuredClone(base),
      id: 'probe.integration.otter.connected-selftest',
      provider: {
        pack: providers.otter.pack,
        implementation: providers.otter.id,
        version: providers.otter.version,
        containment: 'connected'
      },
      credentials: [
        {
          secretRefId: 'secret-ref.otter',
          state: 'passed',
          details: 'The injected resolver reported an authenticated Otter identity.'
        }
      ],
      authorities: [
        {
          id: 'authority.otter.provider',
          state: 'passed',
          details: 'The configured transcript authority was visible.'
        }
      ],
      capabilities: [
        {
          id: 'meeting.transcript.read',
          state: 'passed',
          method: 'read-only',
          details: 'A schema-compatible read-only transcript response was observed.'
        }
      ]
    }
  ];
}

export async function selftest(root) {
  const failures = [];
  const first = resolveConfiguration({ root });
  const second = resolveConfiguration({ root });
  if (fingerprintLock(first) !== fingerprintLock(second)) {
    failures.push('unchanged inputs did not produce a deterministic lock');
  }
  if (JSON.stringify(first).includes('secret-ref') || JSON.stringify(first).includes('OAUTH')) {
    failures.push('configuration lock contains credential-reference material');
  }

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'soter-core-'));
  try {
    fs.cpSync(path.join(root, 'soter'), path.join(temp, 'soter'), { recursive: true });
    fs.copyFileSync(path.join(root, 'AGENTS.md'), path.join(temp, 'AGENTS.md'));
    fs.copyFileSync(path.join(root, 'CLAUDE.md'), path.join(temp, 'CLAUDE.md'));
    fs.cpSync(path.join(root, '.codex'), path.join(temp, '.codex'), { recursive: true });
    fs.cpSync(path.join(root, '.claude'), path.join(temp, '.claude'), { recursive: true });
    const connectedProviders = {
      notion: installSelftestConnectedProvider(
        temp,
        'provider.integration.notion.fixture',
        'provider.integration.notion.connected-selftest'
      ),
      otter: installSelftestConnectedProvider(
        temp,
        'provider.integration.otter.fixture',
        'provider.integration.otter.connected-selftest'
      )
    };
    const lock = resolveConfiguration({ root: temp });
    const lockPath = 'soter/fixtures/meeting-intake/meeting-intake.lock.json';
    writeJson(path.join(temp, lockPath), lock);

    const resolutionEvidence = createResolutionEvidence({
      lock,
      id: 'evidence.meeting-intake.resolution.fixture',
      createdAt: FIXTURE_TIME
    });
    const envelope = prepareRunEnvelope({
      root: temp,
      lock,
      lockPath,
      scenarioPath: 'soter/scenarios/meeting-intake/happy-path.scenario.json',
      runId: 'run.meeting-intake.fixture',
      createdAt: FIXTURE_TIME,
      evidenceIds: [
        resolutionEvidence.id,
        'evidence.meeting-intake.preparation.fixture'
      ]
    });
    const preparationEvidence = createRunPreparationEvidence({
      lock,
      envelope,
      id: 'evidence.meeting-intake.preparation.fixture',
      createdAt: FIXTURE_TIME
    });
    const doctor = runOfflineDoctor({
      root: temp,
      lock,
      doctorId: 'doctor.meeting-intake.fixture',
      evidenceId: 'evidence.meeting-intake.doctor.fixture',
      createdAt: FIXTURE_TIME
    });
    const connectedWithoutProbes = runConnectedDoctor({
      root: temp,
      lock,
      doctorId: 'doctor.meeting-intake.connected-fixture',
      evidenceId: 'evidence.meeting-intake.doctor.fixture',
      createdAt: FIXTURE_TIME,
      providerProbes: []
    });
    const probes = selftestProviderProbes(lock, connectedProviders);
    const connected = runConnectedDoctor({
      root: temp,
      lock,
      doctorId: 'doctor.meeting-intake.connected-selftest',
      evidenceId: 'evidence.meeting-intake.doctor.fixture',
      createdAt: FIXTURE_TIME,
      providerProbes: probes
    });
    const contained = await assembleMeetingIntakeContext({
      root: temp,
      lock,
      lockPath,
      scenarioPath: 'soter/scenarios/meeting-intake/happy-path.scenario.json',
      runId: 'run.meeting-intake.contained-fixture',
      snapshotId: 'context.meeting-intake.contained-fixture',
      createdAt: FIXTURE_TIME,
      meetingId: 'meeting.fixture-001',
      recordingUri: 'otter://fixture/meeting.fixture-001',
      evidenceIds: [
        resolutionEvidence.id,
        'evidence.meeting-intake.context.fixture'
      ]
    });
    const contextEvidence = createContextAssemblyEvidence({
      lock,
      envelope: contained.envelope,
      snapshot: contained.snapshot,
      id: 'evidence.meeting-intake.context.fixture',
      createdAt: FIXTURE_TIME
    });
    const transaction = await runContainedMeetingIntakeTransaction({
      root: temp,
      lock,
      lockPath,
      scenarioPath: 'soter/scenarios/meeting-intake/happy-path.scenario.json',
      runId: 'run.meeting-intake.transaction-fixture',
      snapshotId: 'context.meeting-intake.transaction-fixture',
      changeSetId: 'changeset.meeting-intake.transaction-fixture',
      approvalId: 'approval.meeting-intake.transaction-fixture',
      createdAt: FIXTURE_TIME,
      actor: 'fixture.user',
      approved: true,
      evidenceIds: [
        resolutionEvidence.id,
        'evidence.meeting-intake.transaction.fixture'
      ]
    });
    const transactionEvidence = createContainedTransactionEvidence({
      lock,
      envelope: transaction.envelope,
      changeSet: transaction.changeSet,
      approval: transaction.approval,
      id: 'evidence.meeting-intake.transaction.fixture',
      createdAt: FIXTURE_TIME
    });

    writeJson(path.join(temp, 'soter/fixtures/meeting-intake/preflight.run.json'), envelope);
    writeJson(path.join(temp, 'soter/fixtures/meeting-intake/resolution.evidence.json'), resolutionEvidence);
    writeJson(path.join(temp, 'soter/fixtures/meeting-intake/preparation.evidence.json'), preparationEvidence);
    writeJson(path.join(temp, 'soter/fixtures/meeting-intake/offline.doctor.json'), doctor.report);
    writeJson(
      path.join(temp, 'soter/fixtures/meeting-intake/connected.doctor.json'),
      connectedWithoutProbes.report
    );
    writeJson(path.join(temp, 'soter/fixtures/meeting-intake/contained.run.json'), contained.envelope);
    writeJson(path.join(temp, 'soter/fixtures/meeting-intake/contained.context.json'), contained.snapshot);
    writeJson(path.join(temp, 'soter/fixtures/meeting-intake/contained.evidence.json'), contextEvidence);
    writeJson(path.join(temp, 'soter/fixtures/meeting-intake/transaction.run.json'), transaction.envelope);
    writeJson(path.join(temp, 'soter/fixtures/meeting-intake/transaction.context.json'), transaction.snapshot);
    writeJson(path.join(temp, 'soter/fixtures/meeting-intake/transaction.changeset.json'), transaction.changeSet);
    writeJson(path.join(temp, 'soter/fixtures/meeting-intake/transaction.approval.json'), transaction.approval);
    writeJson(path.join(temp, 'soter/fixtures/meeting-intake/transaction.evidence.json'), transactionEvidence);
    doctor.evidence.forEach((record) => {
      writeJson(path.join(temp, 'soter/fixtures/meeting-intake/' + record.id + '.json'), record);
    });

    const verifiedFixtures = verifySoter(temp);
    if (verifiedFixtures.health.valid !== 'passed') {
      failures.push(
        'generated Core artifacts failed contracts: '
          + verifiedFixtures.violations.map((item) => item.code + ':' + item.what).join(', ')
      );
    }
    if (doctor.report.states.valid !== 'passed'
      || doctor.report.states.ready !== 'unknown'
      || doctor.report.states.verified !== 'unknown'
      || doctor.report.states.healthy !== 'unknown') {
      failures.push('offline doctor overstated or understated its result states');
    }
    if (connected.report.states.valid !== 'passed'
      || connected.report.states.ready !== 'passed'
      || connected.report.states.verified !== 'unknown'
      || connected.report.states.healthy !== 'unknown'
      || connected.report.providerProbeIds.length !== 2) {
      failures.push('connected doctor did not derive readiness without overstating verification or health');
    }
    const expiredProbes = structuredClone(probes);
    expiredProbes[0].probedAt = '2026-07-15T11:00:00.000Z';
    expiredProbes[0].validUntil = '2026-07-15T11:30:00.000Z';
    const expired = runConnectedDoctor({
      root: temp,
      lock,
      doctorId: 'doctor.meeting-intake.expired-selftest',
      evidenceId: 'evidence.meeting-intake.doctor.fixture',
      createdAt: FIXTURE_TIME,
      providerProbes: expiredProbes
    });
    if (expired.report.states.ready !== 'stale'
      || !expired.report.diagnostics.some((item) => item.code === 'SOTER_PROVIDER_PROBE_STALE')) {
      failures.push('connected doctor accepted an expired provider probe as current readiness');
    }
    const mismatchedProbes = structuredClone(probes);
    mismatchedProbes[0].configuration.lockFingerprint = 'sha256:' + '0'.repeat(64);
    const mismatched = runConnectedDoctor({
      root: temp,
      lock,
      doctorId: 'doctor.meeting-intake.mismatched-selftest',
      evidenceId: 'evidence.meeting-intake.doctor.fixture',
      createdAt: FIXTURE_TIME,
      providerProbes: mismatchedProbes
    });
    if (mismatched.report.states.ready !== 'failed'
      || !mismatched.report.diagnostics.some((item) => item.code === 'SOTER_PROVIDER_PROBE_LINK')) {
      failures.push('connected doctor reused a provider probe from a different lock');
    }
    if (envelope.effects.length || envelope.outputs.length || envelope.approvals.length) {
      failures.push('fixture preparation recorded effects, outputs, or approvals that did not occur');
    }
    if (envelope.context.some((item) => item.status !== 'declared' || item.freshness !== 'unknown')) {
      failures.push('fixture envelope represented unloaded context as loaded or fresh');
    }
    if (contained.envelope.lifecycleState !== 'paused'
      || contained.envelope.effects.length !== 3
      || contained.envelope.effects.some((item) => item.state !== 'passed')) {
      failures.push('contained context run did not record three successful typed read invocations and pause');
    }
    if (contained.snapshot.entries.length !== 3
      || contained.snapshot.entries.some((item) => item.freshness !== 'passed')) {
      failures.push('contained context snapshot omitted a source or overstated fixture freshness');
    }
    if (transaction.envelope.lifecycleState !== 'completed'
      || transaction.changeSet.state !== 'committed'
      || transaction.changeSet.verification.state !== 'passed'
      || transaction.changeSet.operations.some((item) => item.state !== 'passed')) {
      failures.push('approved contained transaction did not commit and verify every operation');
    }
    const conflicting = proposeMeetingIntakeChangeSet({
      lock,
      snapshot: transaction.snapshot,
      id: 'changeset.meeting-intake.rollback-fixture',
      runId: transaction.envelope.id,
      createdAt: FIXTURE_TIME
    });
    conflicting.operations[1].input.expectedVersion = '999';
    conflicting.operations[1].inputFingerprint = fingerprintJson(conflicting.operations[1].input);
    conflicting.scopeFingerprint = changeSetScopeFingerprint(conflicting);
    const rollbackApproval = approveChangeSet({
      changeSet: conflicting,
      id: 'approval.meeting-intake.rollback-fixture',
      runId: conflicting.runId,
      createdAt: FIXTURE_TIME,
      actor: 'fixture.user',
      reason: 'Approve the planted-conflict batch to prove contained rollback behavior.'
    });
    const rolledBack = await executeContainedChangeSet({
      root: temp,
      lock,
      changeSet: conflicting,
      approval: rollbackApproval,
      at: FIXTURE_TIME
    });
    if (rolledBack.changeSet.state !== 'rolled-back'
      || rolledBack.changeSet.transaction.rollbackState !== 'passed'
      || rolledBack.changeSet.transaction.restoredFingerprint
        !== rolledBack.changeSet.transaction.checkpointFingerprint) {
      failures.push('planted expected-version conflict did not restore the fixture checkpoint');
    }
    const writeDecision = evaluateEffectPolicy(lock, ['write']);
    if (writeDecision[0].decision !== 'blocked') {
      failures.push('confirmation-required write was not blocked without explicit approval');
    }
    const prohibitedDecision = evaluateEffectPolicy(lock, ['destructive'], ['destructive']);
    if (prohibitedDecision[0].decision !== 'blocked') {
      failures.push('prohibited destructive effect was bypassed by an approval token');
    }
    const syntheticNotionTranslator = {
      prepareMcp({ capability, input }) {
        if (capability !== 'crm.records.read') {
          throw Object.assign(new Error('Selftest translator only prepares CRM reads.'), {
            kind: 'validation'
          });
        }
        return {
          tool: 'query_data_sources',
          arguments: {
            data: {
              mode: 'sql',
              data_source_urls: ['collection://selftest'],
              query: 'SELECT * FROM "collection://selftest" WHERE type = ?',
              params: [input.recordTypes[0]]
            }
          }
        };
      },
      completeMcp({ response, authority, at }) {
        return {
          records: response.records,
          provenance: {
            provider: 'notion-mcp-selftest',
            authority
          },
          observedAt: at
        };
      }
    };
    const hostReadInput = { recordTypes: ['account'] };
    const preparedHostRead = await prepareHostToolCall({
      root: temp,
      lock,
      runId: 'run.meeting-intake.fixture',
      callId: 'toolcall.selftest.notion-read',
      capability: 'crm.records.read',
      authority: 'authority.crm.instance',
      providerImplementation: connectedProviders.notion.id,
      input: hostReadInput,
      at: FIXTURE_TIME,
      translator: syntheticNotionTranslator
    });
    const completedHostRead = await completeHostToolCall({
      root: temp,
      lock,
      call: preparedHostRead.call,
      input: hostReadInput,
      response: {
        records: [
          {
            type: 'account',
            id: 'account.selftest',
            fields: { name: 'Selftest account' }
          }
        ],
        providerSecretMaterial: 'response-only-marker'
      },
      at: FIXTURE_TIME,
      translator: syntheticNotionTranslator
    });
    if (preparedHostRead.call.state !== 'requested'
      || preparedHostRead.call.transport.server !== 'notion'
      || preparedHostRead.call.transport.tool !== 'query_data_sources'
      || completedHostRead.call.state !== 'completed'
      || completedHostRead.output?.records[0]?.id !== 'account.selftest'
      || JSON.stringify(completedHostRead.call).includes('response-only-marker')) {
      failures.push('resumable MCP request/result bridge did not preserve typed dispatch and response minimization');
    }
    const blockedHostWrite = await prepareHostToolCall({
      root: temp,
      lock,
      runId: 'run.meeting-intake.fixture',
      callId: 'toolcall.selftest.notion-write-blocked',
      capability: 'crm.records.create',
      authority: 'authority.crm.instance',
      providerImplementation: connectedProviders.notion.id,
      input: {
        recordType: 'meeting-summary',
        deduplicationKey: 'selftest:mcp-blocked',
        fields: { title: 'Blocked host write' }
      },
      at: FIXTURE_TIME,
      translator: syntheticNotionTranslator
    });
    if (blockedHostWrite.call.state !== 'blocked'
      || blockedHostWrite.call.transport.tool !== null
      || blockedHostWrite.call.arguments !== null) {
      failures.push('confirmation-required write emitted an MCP tool request before approval');
    }
    const failedHostRead = failHostToolCall({
      root: temp,
      lock,
      call: preparedHostRead.call,
      error: Object.assign(new Error('Injected host transport failure.'), { kind: 'unavailable' }),
      at: FIXTURE_TIME
    });
    if (failedHostRead.state !== 'failed' || failedHostRead.error.kind !== 'unavailable') {
      failures.push('host MCP transport failure was not normalized into the portable error vocabulary');
    }
    const credentialLeakAttempt = await prepareHostToolCall({
      root: temp,
      lock,
      runId: 'run.meeting-intake.fixture',
      callId: 'toolcall.selftest.credential-leak',
      capability: 'crm.records.read',
      authority: 'authority.crm.instance',
      providerImplementation: connectedProviders.notion.id,
      input: hostReadInput,
      at: FIXTURE_TIME,
      translator: {
        ...syntheticNotionTranslator,
        prepareMcp() {
          return {
            tool: 'query_data_sources',
            arguments: { authorization: 'Bearer should-never-leave-the-host' }
          };
        }
      }
    });
    if (credentialLeakAttempt.call.state !== 'failed'
      || credentialLeakAttempt.call.arguments !== null
      || credentialLeakAttempt.call.error.kind !== 'validation') {
      failures.push('MCP bridge allowed credential-like material into provider arguments');
    }
    const missingTranscript = await invokeCapability({
      root: temp,
      lock,
      capability: 'meeting.transcript.read',
      authority: 'authority.otter.provider',
      containment: 'fixture',
      input: {
        meetingId: 'meeting.missing',
        recordingUri: 'otter://fixture/meeting.missing'
      },
      effectId: 'effect.meeting-intake.transcript-missing.fixture',
      at: FIXTURE_TIME
    });
    if (missingTranscript.invocation.state !== 'failed'
      || missingTranscript.invocation.error.kind !== 'not-found') {
      failures.push('fixture provider did not normalize missing transcript as not-found');
    }
    const replayState = createFixtureRuntimeState(temp);
    const createInput = {
      recordType: 'meeting-summary',
      deduplicationKey: 'selftest:deduplication',
      fields: { title: 'Selftest summary' }
    };
    const firstCreate = await invokeCapability({
      root: temp,
      lock,
      capability: 'crm.records.create',
      authority: 'authority.crm.instance',
      containment: 'fixture',
      input: createInput,
      effectId: 'effect.selftest.create-first',
      at: FIXTURE_TIME,
      approvedEffects: ['write'],
      runtimeState: replayState
    });
    const replayCreate = await invokeCapability({
      root: temp,
      lock,
      capability: 'crm.records.create',
      authority: 'authority.crm.instance',
      containment: 'fixture',
      input: createInput,
      effectId: 'effect.selftest.create-replay',
      at: FIXTURE_TIME,
      approvedEffects: ['write'],
      runtimeState: replayState
    });
    if (firstCreate.output?.created !== true
      || replayCreate.output?.created !== false
      || firstCreate.output?.record.id !== replayCreate.output?.record.id) {
      failures.push('fixture create did not deduplicate an identical replay');
    }

    fs.appendFileSync(path.join(temp, 'AGENTS.md'), '\nselftest projection change\n');
    const stale = runOfflineDoctor({
      root: temp,
      lock,
      doctorId: 'doctor.meeting-intake.stale',
      evidenceId: 'evidence.meeting-intake.stale',
      createdAt: FIXTURE_TIME
    });
    if (stale.report.states.valid !== 'stale'
      || !stale.report.diagnostics.some((item) => item.code === 'SOTER_LOCK_STALE')) {
      failures.push('doctor did not detect a changed locked projection');
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }

  if (failures.length) {
    failures.forEach((failure) => process.stderr.write('CORE SELFTEST FAIL: ' + failure + '\n'));
    return false;
  }
  process.stdout.write(
    'CORE SELFTEST PASS: deterministic lock, typed fixture reads/writes, exact-scope approval, deduplication, expected-version conflicts, rollback, read-after-write verification, resumable MCP host dispatch, connected probe readiness, expiry, exact-lock binding, honest states, and stale-lock detection.\n'
  );
  return true;
}
