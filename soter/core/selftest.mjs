import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createFixtureRuntimeState,
  evaluateEffectPolicy,
  invokeCapability
} from './capabilities.mjs';
import { assembleMeetingIntakeContext } from './context.mjs';
import {
  finalizeMeetingIntakeConnectedContext,
  prepareMeetingIntakeConnectedContext
} from '../automations/meeting-intake/context.mjs';
import { runConnectedDoctor, runOfflineDoctor } from './doctor.mjs';
import {
  createContextAssemblyEvidence,
  createContainedTransactionEvidence,
  createResolutionEvidence,
  createRunPreparationEvidence
} from './evidence.mjs';
import { fingerprintLock, resolveConfiguration } from './resolve.mjs';
import { prepareRunEnvelope } from './run.mjs';
import { assertOperationPlanDocument } from './operation-plans.mjs';
import {
  commitDurableContextSnapshot,
  completeDurableProviderProbeExecution,
  completeDurableOperationPlanExecution,
  getDurableHostExecution,
  prepareDurableProviderProbeExecution,
  prepareDurableOperationPlanExecution
} from './service.mjs';
import {
  completeHostToolCall,
  failHostToolCall,
  prepareHostToolCall
} from './host-tools.mjs';
import { fingerprintJson, readJson, writeJson } from './lib/canonical-json.mjs';
import {
  completeProviderProbeCall,
  failProviderProbeCall,
  prepareProviderProbeCall
} from './provider-probes.mjs';
import { verifySoter } from '../kernel/verify.mjs';
import {
  approveChangeSet,
  changeSetScopeFingerprint,
  executeContainedChangeSet,
  proposeMeetingIntakeChangeSet,
  runContainedMeetingIntakeTransaction
} from './transaction.mjs';

const FIXTURE_TIME = '2026-07-15T12:00:00.000Z';

function notionProbeStepResponse(checkpoint, identityMarker, driftStepId = null) {
  const source = checkpoint.plan.steps.find((step) => step.id === checkpoint.currentStepId);
  if (source.kind === 'identity') {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          metadata: { type: 'self' },
          self: {
            workspace: { id: 'workspace.selftest', name: identityMarker },
            user: { id: 'user.selftest', name: identityMarker }
          }
        })
      }],
      isError: false
    };
  }
  if (source.kind === 'schema') {
    const schema = Object.fromEntries(source.scope.expectedFields.map((field) => {
      return [field.provider, { name: field.provider, type: field.providerType }];
    }));
    if (source.id === driftStepId) {
      const field = source.scope.expectedFields[0];
      schema[field.provider].type = 'unexpected-selftest-type';
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          metadata: { type: 'data_source' },
          title: 'Private target title ' + identityMarker,
          url: 'https://notion.invalid/private-target',
          text: '<data-source url="{{' + source.scope.targetUri + '}}">\n'
            + '<data-source-state>\n'
            + JSON.stringify({ schema })
            + '\n</data-source-state>\n</data-source>'
        })
      }],
      isError: false
    };
  }
  return {
    structuredContent: {
      result: { results: [], has_more: false }
    }
  };
}

function copyExternalPackArtifacts(sourceRoot, targetRoot) {
  const packDir = path.join(sourceRoot, 'soter', 'packs');
  for (const entry of fs.readdirSync(packDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(packDir, entry.name, 'pack.json');
    if (!fs.existsSync(manifestPath)) continue;
    const pack = readJson(manifestPath);
    for (const artifact of pack.artifacts || []) {
      const source = path.resolve(sourceRoot, artifact.path);
      const relative = path.relative(sourceRoot, source);
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)
        || relative === 'soter' || relative.startsWith('soter' + path.sep)
        || !fs.existsSync(source)) {
        continue;
      }
      const target = path.resolve(targetRoot, artifact.path);
      const targetRelative = path.relative(targetRoot, target);
      if (targetRelative === '..' || targetRelative.startsWith('..' + path.sep)
        || path.isAbsolute(targetRelative)) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (fs.statSync(source).isDirectory()) {
        fs.cpSync(source, target, { recursive: true });
      } else {
        fs.copyFileSync(source, target);
      }
    }
  }
}

function installSelftestConnectedProvider(root, sourceId, targetId, capabilityIds) {
  const sourcePath = path.join(root, 'soter/providers/' + sourceId + '.json');
  const provider = structuredClone(readJson(sourcePath));
  provider.id = targetId;
  provider.containment = 'connected';
  provider.capabilities = provider.capabilities.filter((capability) => {
    return capabilityIds.includes(capability.id);
  });
  provider.runtime = {
    engine: 'mcp',
    module: provider.runtime.module,
    prepareExport: 'prepareMcp',
    completeExport: 'completeMcp',
    probePrepareExport: 'prepareProbeMcp',
    probeCompleteExport: 'completeProbeMcp',
    server: 'notion',
    tools: ['fetch', 'create_pages', 'update_page'],
    probeTools: ['fetch']
  };
  provider.mappings = [];
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
        }
      ]
    },
    {
      ...structuredClone(base),
      id: 'probe.integration.notion-writes.connected-selftest',
      provider: {
        pack: providers.notionWrites.pack,
        implementation: providers.notionWrites.id,
        version: providers.notionWrites.version,
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
          id: 'authority.crm.instance',
          state: 'passed',
          details: 'The configured CRM instance authority was visible.'
        }
      ],
      capabilities: [
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
    copyExternalPackArtifacts(root, temp);
    fs.copyFileSync(path.join(root, 'AGENTS.md'), path.join(temp, 'AGENTS.md'));
    fs.copyFileSync(path.join(root, 'CLAUDE.md'), path.join(temp, 'CLAUDE.md'));
    fs.cpSync(path.join(root, '.codex'), path.join(temp, '.codex'), { recursive: true });
    fs.cpSync(path.join(root, '.claude'), path.join(temp, '.claude'), { recursive: true });
    const connectedProviders = {
      notion: readJson(path.join(
        temp,
        'soter/providers/provider.integration.notion.mcp.json'
      )),
      notionWrites: installSelftestConnectedProvider(
        temp,
        'provider.integration.notion.fixture',
        'provider.integration.notion.writes-connected-selftest',
        ['crm.records.create', 'crm.records.update']
      ),
      otter: readJson(path.join(
        temp,
        'soter/providers/provider.integration.otter.mcp.json'
      ))
    };
    const lock = resolveConfiguration({ root: temp });
    const lockPath = 'soter/fixtures/meeting-intake/meeting-intake.lock.json';
    writeJson(path.join(temp, lockPath), lock);

    const preparedOtterProbe = await prepareProviderProbeCall({
      root: temp,
      lock,
      providerImplementation: connectedProviders.otter.id,
      callId: 'probecall.selftest.otter-identity',
      probeId: 'probe.integration.otter.identity-selftest',
      at: FIXTURE_TIME
    });
    const identityMarker = 'private-identity-selftest-marker';
    const completedOtterProbe = await completeProviderProbeCall({
      root: temp,
      lock,
      call: preparedOtterProbe.call,
      response: {
        structuredContent: {
          result: identityMarker
        }
      },
      at: FIXTURE_TIME
    });
    if (preparedOtterProbe.call.state !== 'requested'
      || preparedOtterProbe.call.transport.operation !== 'get_user_info'
      || preparedOtterProbe.call.transport.tool !== 'mcp__otter__get_user_info'
      || Object.keys(preparedOtterProbe.call.arguments).length !== 0
      || completedOtterProbe.call.state !== 'completed'
      || completedOtterProbe.probe?.reachability.state !== 'passed'
      || completedOtterProbe.probe?.capabilities[0]?.state !== 'unknown'
      || JSON.stringify(completedOtterProbe).includes(identityMarker)) {
      failures.push('Otter identity probe did not preserve safe request scope and honest capability state');
    }
    const widenedOtterProbe = await completeProviderProbeCall({
      root: temp,
      lock,
      call: preparedOtterProbe.call,
      response: { structuredContent: { result: 'synthetic identity' } },
      at: FIXTURE_TIME,
      translator: {
        completeProbeMcp({ plan }) {
          return {
            credentials: plan.credentialRefs.map((secretRefId) => ({
              secretRefId,
              state: 'passed',
              details: 'Synthetic credential observation.'
            })),
            reachability: {
              state: 'passed',
              details: 'Synthetic reachability observation.'
            },
            authorities: plan.authorities.map((id) => ({
              id,
              state: 'passed',
              details: 'Synthetic authority observation.'
            })),
            capabilities: [
              ...plan.capabilities.map((id) => ({
                id,
                state: 'unknown',
                method: 'metadata',
                details: 'Synthetic capability observation.'
              })),
              {
                id: 'crm.records.read',
                state: 'passed',
                method: 'metadata',
                details: 'This observation is deliberately outside the probe plan.'
              }
            ],
            limitations: ['Synthetic widened-scope probe must fail.']
          };
        }
      }
    });
    if (widenedOtterProbe.call.state !== 'failed'
      || widenedOtterProbe.call.error.kind !== 'validation') {
      failures.push('provider probe translator widened the exact locked observation plan');
    }
    const failedOtterProbe = failProviderProbeCall({
      root: temp,
      lock,
      call: preparedOtterProbe.call,
      error: Object.assign(new Error('Injected probe transport failure.'), {
        kind: 'unavailable'
      }),
      at: FIXTURE_TIME
    });
    if (failedOtterProbe.state !== 'failed'
      || failedOtterProbe.error.kind !== 'unavailable') {
      failures.push('provider probe host failure was not normalized into the portable error vocabulary');
    }

    const preparedNotionProbe = await prepareProviderProbeCall({
      root: temp,
      lock,
      providerImplementation: connectedProviders.notion.id,
      callId: 'probecall.selftest.notion-identity',
      probeId: 'probe.integration.notion.identity-selftest',
      at: FIXTURE_TIME
    });
    const notionIdentityMarker = 'private-notion-identity-selftest-marker';
    const completedNotionProbe = await completeProviderProbeCall({
      root: temp,
      lock,
      call: preparedNotionProbe.call,
      response: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              metadata: { type: 'self' },
              self: {
                workspace: { id: 'workspace.selftest', name: notionIdentityMarker },
                user: { id: 'user.selftest', name: notionIdentityMarker }
              }
            })
          }
        ],
        isError: false
      },
      at: FIXTURE_TIME
    });
    if (preparedNotionProbe.call.state !== 'requested'
      || preparedNotionProbe.call.transport.operation !== 'fetch'
      || preparedNotionProbe.call.transport.tool !== 'mcp__codex_apps__notion_fetch'
      || preparedNotionProbe.call.arguments.id !== 'self'
      || completedNotionProbe.call.state !== 'completed'
      || completedNotionProbe.probe?.reachability.state !== 'passed'
      || completedNotionProbe.probe?.authorities.some((item) => item.state !== 'unknown')
      || completedNotionProbe.probe?.capabilities.some((item) => item.state !== 'unknown')
      || JSON.stringify(completedNotionProbe).includes(notionIdentityMarker)) {
      failures.push('Notion identity probe did not preserve native routing, minimization, and honest unknown states');
    }

    const notionPlanMarker = 'private-notion-plan-selftest-marker';
    let notionPlan = await prepareDurableProviderProbeExecution({
      root: temp,
      lockPath,
      providerImplementation: connectedProviders.notion.id,
      probeId: 'probe.integration.notion.plan-selftest',
      at: FIXTURE_TIME,
      validForSeconds: 300
    });
    const firstNotionPlanCall = notionPlan.currentCall;
    const firstNotionPlanResponse = notionProbeStepResponse(
      notionPlan.checkpoint,
      notionPlanMarker
    );
    notionPlan = await completeDurableProviderProbeExecution({
      root: temp,
      checkpointId: notionPlan.checkpoint.id,
      callId: firstNotionPlanCall.id,
      response: firstNotionPlanResponse,
      at: FIXTURE_TIME
    });
    const repeatedNotionPlanStep = await completeDurableProviderProbeExecution({
      root: temp,
      checkpointId: notionPlan.checkpoint.id,
      callId: firstNotionPlanCall.id,
      response: firstNotionPlanResponse,
      at: FIXTURE_TIME
    });
    if (repeatedNotionPlanStep.checkpoint.checkpointFingerprint
      !== notionPlan.checkpoint.checkpointFingerprint
      || repeatedNotionPlanStep.currentCall?.id !== notionPlan.currentCall?.id) {
      failures.push('Notion probe plan did not idempotently recover a repeated completed step response');
    }
    let notionPlanCalls = 1;
    while (notionPlan.checkpoint.state === 'requested') {
      const currentCall = notionPlan.currentCall;
      const response = notionProbeStepResponse(
        notionPlan.checkpoint,
        notionPlanMarker
      );
      notionPlan = await completeDurableProviderProbeExecution({
        root: temp,
        checkpointId: notionPlan.checkpoint.id,
        callId: currentCall.id,
        response,
        at: FIXTURE_TIME
      });
      notionPlanCalls += 1;
    }
    const notionPlanState = fs.readFileSync(
      path.join(temp, notionPlan.checkpointPath),
      'utf8'
    );
    if (notionPlanCalls !== 15
      || notionPlan.checkpoint.state !== 'completed'
      || notionPlan.checkpoint.result?.$contract !== 'soter://contracts/provider-probe/v2'
      || notionPlan.checkpoint.result?.checks.length !== 15
      || notionPlan.checkpoint.result?.checks.some((check) => check.state !== 'passed')
      || notionPlan.checkpoint.result?.capabilities[0]?.state !== 'passed'
      || notionPlan.currentCall !== null
      || JSON.stringify(notionPlan).includes(notionPlanMarker)
      || notionPlanState.includes(notionPlanMarker)) {
      failures.push(
        'Notion probe plan did not sequence, minimize, and close exact schema/read checks: '
          + JSON.stringify({
            calls: notionPlanCalls,
            state: notionPlan.checkpoint.state,
            contract: notionPlan.checkpoint.result?.$contract || null,
            checks: notionPlan.checkpoint.result?.checks?.length || null,
            capability: notionPlan.checkpoint.result?.capabilities?.[0]?.state || null,
            currentCall: notionPlan.currentCall?.id || null,
            markerInResult: JSON.stringify(notionPlan).includes(notionPlanMarker),
            markerInState: notionPlanState.includes(notionPlanMarker),
            failedStep: notionPlan.checkpoint.steps.find((step) => step.state === 'failed')?.id || null,
            error: notionPlan.checkpoint.steps.find((step) => step.state === 'failed')?.error || null
          })
      );
    }

    let driftedNotionPlan = await prepareDurableProviderProbeExecution({
      root: temp,
      lockPath,
      providerImplementation: connectedProviders.notion.id,
      probeId: 'probe.integration.notion.schema-drift-selftest',
      at: FIXTURE_TIME,
      validForSeconds: 300
    });
    const driftStepId = 'step.target.organizations.schema';
    while (driftedNotionPlan.checkpoint.state === 'requested') {
      const currentCall = driftedNotionPlan.currentCall;
      const response = notionProbeStepResponse(
        driftedNotionPlan.checkpoint,
        notionPlanMarker,
        driftStepId
      );
      driftedNotionPlan = await completeDurableProviderProbeExecution({
        root: temp,
        checkpointId: driftedNotionPlan.checkpoint.id,
        callId: currentCall.id,
        response,
        at: FIXTURE_TIME
      });
    }
    const driftedStep = driftedNotionPlan.checkpoint.steps.find((step) => {
      return step.id === driftStepId;
    });
    if (driftedNotionPlan.checkpoint.state !== 'failed'
      || driftedStep?.error?.kind !== 'validation'
      || driftedNotionPlan.checkpoint.result !== null) {
      failures.push('Notion probe plan did not fail closed on mapped provider schema drift');
    }

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
    const failedOtterAttempt = {
      $contract: 'soter://contracts/provider-probe-attempt/v1',
      contractVersion: '1.0.0',
      id: 'probeattempt.selftest.otter-unavailable',
      probeId: 'probe.integration.otter.unavailable-selftest',
      checkpointId: 'checkpoint.probecall.selftest.otter-unavailable',
      attemptedAt: '2026-07-15T11:58:00.000Z',
      failedAt: '2026-07-15T11:59:00.000Z',
      validUntil: '2026-07-15T12:04:00.000Z',
      state: 'failed',
      configuration: {
        name: lock.configuration.name,
        lockFingerprint: fingerprintLock(lock)
      },
      host: {
        id: lock.host.id,
        adapter: lock.host.adapter,
        version: lock.host.version
      },
      provider: {
        pack: connectedProviders.otter.pack,
        implementation: connectedProviders.otter.id,
        version: connectedProviders.otter.version,
        containment: 'connected'
      },
      scope: {
        credentialRefs: ['secret-ref.otter'],
        authorities: ['authority.otter.provider'],
        capabilities: ['meeting.transcript.read']
      },
      failure: {
        kind: 'unavailable',
        errorFingerprint: 'sha256:' + '1'.repeat(64),
        step: null,
        callId: 'probecall.selftest.otter-unavailable',
        transport: {
          protocol: 'mcp',
          server: 'otter',
          operation: 'get_user_info',
          tool: 'mcp__otter__get_user_info'
        }
      },
      sourceCheckpointFingerprint: 'sha256:' + '2'.repeat(64),
      privacy: {
        scope: 'private',
        rawProviderResponsePersisted: false,
        hostCredentialValuesPersisted: false,
        providerArgumentsIncluded: false,
        providerErrorMessageIncluded: false
      }
    };
    const connectedWithFailedAttempt = runConnectedDoctor({
      root: temp,
      lock,
      doctorId: 'doctor.meeting-intake.failed-attempt-selftest',
      evidenceId: 'evidence.meeting-intake.doctor.fixture',
      createdAt: FIXTURE_TIME,
      providerProbes: probes.filter((probe) => {
        return probe.provider.implementation !== connectedProviders.otter.id;
      }),
      providerProbeAttempts: [failedOtterAttempt]
    });
    const expiredOtterAttempt = structuredClone(failedOtterAttempt);
    expiredOtterAttempt.validUntil = '2026-07-15T11:59:30.000Z';
    const connectedWithExpiredAttempt = runConnectedDoctor({
      root: temp,
      lock,
      doctorId: 'doctor.meeting-intake.expired-attempt-selftest',
      evidenceId: 'evidence.meeting-intake.doctor.fixture',
      createdAt: FIXTURE_TIME,
      providerProbes: probes.filter((probe) => {
        return probe.provider.implementation !== connectedProviders.otter.id;
      }),
      providerProbeAttempts: [expiredOtterAttempt]
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
    if (connectedWithoutProbes.report.states.ready !== 'unknown'
      || connectedWithoutProbes.report.checks.find((item) => {
        return item.id === 'integrations.implementations-ready';
      })?.state !== 'passed') {
      failures.push('connected doctor confused missing probes with missing provider implementations');
    }
    if (connected.report.states.valid !== 'passed'
      || connected.report.states.ready !== 'passed'
      || connected.report.states.verified !== 'unknown'
      || connected.report.states.healthy !== 'unknown'
      || connected.report.providerProbeIds.length !== 3) {
      failures.push('connected doctor did not derive readiness without overstating verification or health');
    }
    if (connectedWithFailedAttempt.report.states.ready !== 'failed'
      || !connectedWithFailedAttempt.report.diagnostics.some((item) => {
        return item.code === 'SOTER_PROVIDER_PROBE_UNAVAILABLE'
          && item.subject === connectedProviders.otter.id;
      })
      || connectedWithFailedAttempt.report.diagnostics.some((item) => {
        return item.code === 'SOTER_PROVIDER_PROBE_MISSING'
          && item.subject === connectedProviders.otter.id;
      })
      || connectedWithFailedAttempt.report.checks.find((item) => {
        return item.id === 'integrations.probes-complete';
      })?.state !== 'failed') {
      failures.push('connected doctor collapsed an exact failed provider attempt into a missing probe');
    }
    if (connectedWithExpiredAttempt.report.states.ready !== 'stale'
      || !connectedWithExpiredAttempt.report.diagnostics.some((item) => {
        return item.code === 'SOTER_PROVIDER_PROBE_ATTEMPT_STALE';
      })) {
      failures.push('connected doctor treated an expired provider failure as current');
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
    const operationPlan = {
      $contract: 'soter://contracts/operation-plan/v1',
      contractVersion: '1.0.0',
      id: 'plan.meeting-intake.multi-target-selftest',
      runId: envelope.id,
      createdAt: FIXTURE_TIME,
      mode: 'sequential',
      failurePolicy: 'stop',
      reason: 'Prove that Core can resume two portable Notion reads without using cross-data-source SQL.',
      steps: [
        {
          id: 'step.read-meeting',
          capability: 'crm.records.read',
          authority: 'authority.crm.instance',
          providerImplementation: connectedProviders.notion.id,
          input: { recordTypes: ['meeting'], limit: 1 },
          reason: 'Read one meeting target through its portable capability.'
        },
        {
          id: 'step.read-task',
          capability: 'crm.records.read',
          authority: 'authority.crm.instance',
          providerImplementation: connectedProviders.notion.id,
          input: { recordTypes: ['task'], limit: 1 },
          reason: 'Read one task target after the meeting step completes.'
        }
      ]
    };
    const duplicateStepPlan = structuredClone(operationPlan);
    duplicateStepPlan.steps[1].id = duplicateStepPlan.steps[0].id;
    let duplicatePlanStepRejected = false;
    try {
      assertOperationPlanDocument(temp, duplicateStepPlan);
    } catch (error) {
      duplicatePlanStepRejected = error.message.includes('identifiers must be unique');
    }
    const wrongAutomationRunPath = 'soter/fixtures/meeting-intake/wrong-automation-selftest.run.json';
    const wrongAutomationRun = readJson(
      path.join(temp, 'soter/fixtures/meeting-intake/preflight.run.json')
    );
    wrongAutomationRun.id = 'run.meeting-intake.wrong-automation-selftest';
    wrongAutomationRun.automation.id = 'automation.not-selected';
    writeJson(path.join(temp, wrongAutomationRunPath), wrongAutomationRun);
    const wrongAutomationPlan = structuredClone(operationPlan);
    wrongAutomationPlan.id = 'plan.meeting-intake.wrong-automation-selftest';
    wrongAutomationPlan.runId = wrongAutomationRun.id;
    let wrongAutomationRejected = false;
    try {
      await prepareDurableOperationPlanExecution({
        root: temp,
        lockPath,
        runPath: wrongAutomationRunPath,
        plan: wrongAutomationPlan,
        at: FIXTURE_TIME,
        expectedHost: 'codex'
      });
    } catch (error) {
      wrongAutomationRejected = error.message.includes(
        'exact selected automation and authority declarations'
      );
    }
    const invalidTailPlan = structuredClone(operationPlan);
    invalidTailPlan.id = 'plan.meeting-intake.invalid-tail-selftest';
    invalidTailPlan.steps[1].providerImplementation = 'provider.missing.connected';
    let invalidTailRejectedBeforeDispatch = false;
    try {
      await prepareDurableOperationPlanExecution({
        root: temp,
        lockPath,
        runPath: 'soter/fixtures/meeting-intake/preflight.run.json',
        plan: invalidTailPlan,
        at: FIXTURE_TIME,
        expectedHost: 'codex'
      });
    } catch (error) {
      invalidTailRejectedBeforeDispatch = error.message.includes(
        'step.read-task cannot be prepared'
      );
    }
    const invalidTailCheckpoint = path.join(
      temp,
      '.soter/state/host-calls/checkpoint.plan.meeting-intake.invalid-tail-selftest.json'
    );
    const preparedPlan = await prepareDurableOperationPlanExecution({
      root: temp,
      lockPath,
      runPath: 'soter/fixtures/meeting-intake/preflight.run.json',
      plan: operationPlan,
      at: FIXTURE_TIME,
      expectedHost: 'codex'
    });
    const firstPlanCall = preparedPlan.currentCall;
    const firstPlanResponse = {
      content: [{
        type: 'text',
        text: JSON.stringify({
          results: [{
            __soterType: 'meeting',
            __soterId: 'https://app.notion.com/plan-meeting-selftest',
            __soterFields: JSON.stringify({
              title: 'Plan selftest meeting',
              meetingType: 'Project Sync',
              recordingUri: null,
              organizationUris: '[]',
              participantIds: '[]'
            })
          }],
          has_more: false
        })
      }],
      privateMarker: 'raw-plan-meeting-response-marker'
    };
    const advancedPlan = await completeDurableOperationPlanExecution({
      root: temp,
      checkpointId: preparedPlan.checkpoint.id,
      callId: firstPlanCall.id,
      response: firstPlanResponse,
      at: '2026-07-15T12:00:01.000Z',
      expectedHost: 'codex'
    });
    const secondPlanCall = advancedPlan.currentCall;
    const rehydratedPlan = getDurableHostExecution({
      root: temp,
      checkpointId: preparedPlan.checkpoint.id,
      expectedHost: 'codex'
    });
    let wrongPlanCallRejected = false;
    try {
      await completeDurableOperationPlanExecution({
        root: temp,
        checkpointId: preparedPlan.checkpoint.id,
        callId: 'toolcall.wrong-plan-step',
        response: firstPlanResponse,
        at: '2026-07-15T12:00:01.500Z',
        expectedHost: 'codex'
      });
    } catch (error) {
      wrongPlanCallRejected = error.message.includes('exact current step call');
    }
    const secondPlanResponse = {
      structuredContent: {
        result: {
          results: [{
            __soterType: 'task',
            __soterId: 'https://app.notion.com/plan-task-selftest',
            __soterFields: JSON.stringify({
              title: 'Plan selftest task',
              status: 'Open',
              context: null,
              projectUris: '[]'
            })
          }],
          has_more: false
        }
      },
      privateMarker: 'raw-plan-task-response-marker'
    };
    const completedPlan = await completeDurableOperationPlanExecution({
      root: temp,
      checkpointId: preparedPlan.checkpoint.id,
      callId: secondPlanCall.id,
      response: secondPlanResponse,
      at: '2026-07-15T12:00:02.000Z',
      expectedHost: 'codex'
    });
    const replayedFirstPlanStep = await completeDurableOperationPlanExecution({
      root: temp,
      checkpointId: preparedPlan.checkpoint.id,
      callId: firstPlanCall.id,
      response: firstPlanResponse,
      at: '2026-07-15T12:00:03.000Z',
      expectedHost: 'codex'
    });
    if (!duplicatePlanStepRejected
      || !wrongAutomationRejected
      || !invalidTailRejectedBeforeDispatch
      || fs.existsSync(invalidTailCheckpoint)
      || preparedPlan.checkpoint.state !== 'requested'
      || firstPlanCall?.capability.id !== 'crm.records.read'
      || firstPlanCall?.arguments?.data?.data_source_urls?.length !== 1
      || advancedPlan.checkpoint.state !== 'requested'
      || advancedPlan.checkpoint.currentStepId !== 'step.read-task'
      || advancedPlan.checkpoint.steps[0]?.state !== 'completed'
      || secondPlanCall?.id === firstPlanCall?.id
      || rehydratedPlan.checkpoint.currentStepId !== 'step.read-task'
      || !wrongPlanCallRejected
      || completedPlan.checkpoint.state !== 'completed'
      || completedPlan.checkpoint.currentStepId !== null
      || completedPlan.checkpoint.steps.some((step) => step.state !== 'completed')
      || completedPlan.checkpoint.result?.outputFingerprints.length !== 2
      || replayedFirstPlanStep.checkpoint.checkpointFingerprint
        !== completedPlan.checkpoint.checkpointFingerprint
      || JSON.stringify(completedPlan).includes('raw-plan-')) {
      failures.push('durable operation plan did not preserve exact sequential dispatch, recovery, idempotency, and response minimization');
    }
    const failedBindingRunPath = 'soter/fixtures/meeting-intake/failed-binding-selftest.run.json';
    const failedBindingRun = readJson(
      path.join(temp, 'soter/fixtures/meeting-intake/preflight.run.json')
    );
    failedBindingRun.id = 'run.meeting-intake.failed-binding-selftest';
    writeJson(path.join(temp, failedBindingRunPath), failedBindingRun);
    const failedBindingPlan = {
      $contract: 'soter://contracts/operation-plan/v2',
      contractVersion: '2.0.0',
      id: 'plan.meeting-intake.failed-binding-selftest',
      runId: failedBindingRun.id,
      createdAt: FIXTURE_TIME,
      mode: 'sequential',
      failurePolicy: 'stop',
      reason: 'Prove empty fail-plan bindings stop deterministically without emitting a broad provider request.',
      steps: [
        {
          id: 'step.binding-source-meeting',
          capability: 'crm.records.read',
          authority: 'authority.crm.instance',
          providerImplementation: connectedProviders.notion.id,
          input: { recordTypes: ['meeting'], limit: 1 },
          inputBindings: [],
          reason: 'Read one meeting that has no organization relations.'
        },
        {
          id: 'step.binding-required-organizations',
          capability: 'crm.records.read',
          authority: 'authority.crm.instance',
          providerImplementation: connectedProviders.notion.id,
          input: { recordTypes: ['organization'], limit: 100 },
          inputBindings: [{
            id: 'binding.required-organization-uris',
            sourceStepId: 'step.binding-source-meeting',
            sourcePath: ['records', '*', 'fields', 'organizationUris'],
            targetPath: ['ids'],
            transform: 'unique-string-list',
            onEmpty: 'fail-plan'
          }],
          reason: 'Require at least one referenced organization without allowing an unfiltered read.'
        }
      ]
    };
    const invalidBoundTailPlan = structuredClone(failedBindingPlan);
    invalidBoundTailPlan.id = 'plan.meeting-intake.invalid-bound-tail-selftest';
    invalidBoundTailPlan.steps[1].providerImplementation = 'provider.missing.connected';
    let invalidBoundTailRejected = false;
    try {
      await prepareDurableOperationPlanExecution({
        root: temp,
        lockPath,
        runPath: failedBindingRunPath,
        plan: invalidBoundTailPlan,
        at: FIXTURE_TIME,
        expectedHost: 'codex'
      });
    } catch (error) {
      invalidBoundTailRejected = error.message.includes(
        'step.binding-required-organizations cannot be prepared'
      );
    }
    const preparedFailedBinding = await prepareDurableOperationPlanExecution({
      root: temp,
      lockPath,
      runPath: failedBindingRunPath,
      plan: failedBindingPlan,
      at: FIXTURE_TIME,
      expectedHost: 'codex'
    });
    const completedFailedBinding = await completeDurableOperationPlanExecution({
      root: temp,
      checkpointId: preparedFailedBinding.checkpoint.id,
      callId: preparedFailedBinding.currentCall.id,
      response: firstPlanResponse,
      at: '2026-07-15T12:00:03.500Z',
      expectedHost: 'codex'
    });
    if (!invalidBoundTailRejected
      || fs.existsSync(path.join(
        temp,
        '.soter/state/host-calls/checkpoint.plan.meeting-intake.invalid-bound-tail-selftest.json'
      ))
      || completedFailedBinding.checkpoint.state !== 'failed'
      || completedFailedBinding.currentCall !== null
      || completedFailedBinding.checkpoint.steps[1]?.state !== 'failed'
      || completedFailedBinding.checkpoint.steps[1]?.call !== null
      || completedFailedBinding.checkpoint.steps[1]?.resolvedInput?.ids?.length !== 0
      || completedFailedBinding.checkpoint.steps[1]?.bindingResolutions[0]?.state !== 'empty') {
      failures.push('bound plan preflight or empty fail-plan semantics allowed unsafe provider work');
    }
    const connectedContextRecording = 'https://otter.ai/u/context-selftest';
    const connectedContextRunPath = 'soter/fixtures/meeting-intake/connected-context-selftest.run.json';
    const connectedContextRun = readJson(
      path.join(temp, 'soter/fixtures/meeting-intake/preflight.run.json')
    );
    connectedContextRun.id = 'run.meeting-intake.connected-context-selftest';
    writeJson(path.join(temp, connectedContextRunPath), connectedContextRun);
    const preparedConnectedContext = await prepareMeetingIntakeConnectedContext({
      root: temp,
      lockPath,
      runPath: connectedContextRunPath,
      snapshotId: 'context.meeting-intake.connected.selftest',
      meetingId: 'meeting.context-selftest',
      recordingUri: connectedContextRecording,
      at: '2026-07-15T12:00:04.000Z',
      expectedHost: 'codex'
    });
    const forwardBoundPlan = structuredClone(preparedConnectedContext.checkpoint.plan);
    forwardBoundPlan.steps[3].inputBindings[0].sourceStepId = 'step.context-tasks';
    let forwardBindingRejected = false;
    try {
      assertOperationPlanDocument(temp, forwardBoundPlan);
    } catch (error) {
      forwardBindingRejected = error.message.includes('earlier step');
    }
    const overwritingBoundPlan = structuredClone(preparedConnectedContext.checkpoint.plan);
    overwritingBoundPlan.steps[3].input.ids = ['https://app.notion.com/fixed-broad-id'];
    let bindingOverwriteRejected = false;
    try {
      assertOperationPlanDocument(temp, overwritingBoundPlan);
    } catch (error) {
      bindingOverwriteRejected = error.message.includes('cannot overwrite');
    }
    const overlappingBoundPlan = structuredClone(preparedConnectedContext.checkpoint.plan);
    overlappingBoundPlan.steps[3].inputBindings.push({
      id: 'binding.context-overlapping-organization-uris',
      sourceStepId: 'step.context-meeting-record',
      sourcePath: ['records', '*', 'fields', 'organizationUris'],
      targetPath: ['ids', 'nested'],
      transform: 'unique-string-list',
      onEmpty: 'skip-step'
    });
    let bindingOverlapRejected = false;
    try {
      assertOperationPlanDocument(temp, overlappingBoundPlan);
    } catch (error) {
      bindingOverlapRejected = error.message.includes('duplicate or overlap');
    }
    let incompleteContextRejected = false;
    try {
      finalizeMeetingIntakeConnectedContext({
        root: temp,
        checkpointId: preparedConnectedContext.checkpoint.id,
        expectedHost: 'codex'
      });
    } catch (error) {
      incompleteContextRejected = error.message.includes('completed operation plan');
    }
    const contextPolicyMarker = 'raw-connected-context-policy-marker';
    const contextPolicyResponse = {
      content: [{
        type: 'text',
        text: JSON.stringify({
          results: [{
            __soterType: 'policy',
            __soterId: 'https://app.notion.com/context-policy-selftest',
            __soterFields: JSON.stringify({ name: 'Meeting intake policy index' })
          }],
          has_more: false
        })
      }],
      privateMarker: contextPolicyMarker
    };
    const connectedContextTranscript = await completeDurableOperationPlanExecution({
      root: temp,
      checkpointId: preparedConnectedContext.checkpoint.id,
      callId: preparedConnectedContext.currentCall.id,
      response: contextPolicyResponse,
      at: '2026-07-15T12:00:05.000Z',
      expectedHost: 'codex'
    });
    const contextTranscriptMarker = 'raw-connected-context-transcript-marker';
    const contextTranscriptResponse = {
      structuredContent: {
        result: {
          speakers: [
            { id: 'speaker.retro', displayName: 'Retro' },
            { id: 'speaker.maya', displayName: 'Maya' }
          ],
          segments: [{
            speakerId: 'speaker.maya',
            text: 'Please send the grounded follow-up.',
            startSeconds: 12
          }]
        }
      },
      privateMarker: contextTranscriptMarker
    };
    const connectedContextMeeting = await completeDurableOperationPlanExecution({
      root: temp,
      checkpointId: preparedConnectedContext.checkpoint.id,
      callId: connectedContextTranscript.currentCall.id,
      response: contextTranscriptResponse,
      at: '2026-07-15T12:00:06.000Z',
      expectedHost: 'codex'
    });
    const contextMeetingMarker = 'raw-connected-context-meeting-marker';
    const contextOrganizationMarker = 'raw-connected-context-organization-marker';
    const contextProjectMarker = 'raw-connected-context-project-marker';
    const contextTaskMarker = 'raw-connected-context-task-marker';
    const contextOrganizationUri = 'https://app.notion.com/context-organization-selftest';
    const contextProjectUri = 'https://app.notion.com/context-project-selftest';
    const contextTaskUri = 'https://app.notion.com/context-task-selftest';
    const contextMeetingResponse = {
      structuredContent: {
        result: {
          results: [{
            __soterType: 'meeting',
            __soterId: 'https://app.notion.com/context-meeting-selftest',
            __soterFields: JSON.stringify({
              title: 'Connected context selftest',
              meetingType: 'Project Sync',
              recordingUri: connectedContextRecording,
              organizationUris: JSON.stringify([contextOrganizationUri]),
              participantIds: JSON.stringify(['person.retro'])
            })
          }],
          has_more: false
        }
      },
      privateMarker: contextMeetingMarker
    };
    const connectedContextOrganization = await completeDurableOperationPlanExecution({
      root: temp,
      checkpointId: preparedConnectedContext.checkpoint.id,
      callId: connectedContextMeeting.currentCall.id,
      response: contextMeetingResponse,
      at: '2026-07-15T12:00:07.000Z',
      expectedHost: 'codex'
    });
    const connectedContextProject = await completeDurableOperationPlanExecution({
      root: temp,
      checkpointId: preparedConnectedContext.checkpoint.id,
      callId: connectedContextOrganization.currentCall.id,
      response: {
        structuredContent: {
          result: {
            results: [{
              __soterType: 'organization',
              __soterId: contextOrganizationUri,
              __soterFields: JSON.stringify({
                name: 'Bound organization',
                organizationType: 'Client',
                tags: '[]',
                projectUris: JSON.stringify([contextProjectUri]),
                contactUris: '[]'
              })
            }],
            has_more: false
          }
        },
        privateMarker: contextOrganizationMarker
      },
      at: '2026-07-15T12:00:08.000Z',
      expectedHost: 'codex'
    });
    const connectedContextTask = await completeDurableOperationPlanExecution({
      root: temp,
      checkpointId: preparedConnectedContext.checkpoint.id,
      callId: connectedContextProject.currentCall.id,
      response: {
        structuredContent: {
          result: {
            results: [{
              __soterType: 'project',
              __soterId: contextProjectUri,
              __soterFields: JSON.stringify({
                name: 'Bound project',
                projectType: 'Client Project',
                status: 'Active',
                organizationUris: JSON.stringify([contextOrganizationUri]),
                taskUris: JSON.stringify([contextTaskUri])
              })
            }],
            has_more: false
          }
        },
        privateMarker: contextProjectMarker
      },
      at: '2026-07-15T12:00:09.000Z',
      expectedHost: 'codex'
    });
    const completedConnectedContext = await completeDurableOperationPlanExecution({
      root: temp,
      checkpointId: preparedConnectedContext.checkpoint.id,
      callId: connectedContextTask.currentCall.id,
      response: {
        structuredContent: {
          result: {
            results: [{
              __soterType: 'task',
              __soterId: contextTaskUri,
              __soterFields: JSON.stringify({
                title: 'Bound task',
                status: 'Open',
                context: 'Derived only from the selected project relation.',
                projectUris: JSON.stringify([contextProjectUri])
              })
            }],
            has_more: false
          }
        },
        privateMarker: contextTaskMarker
      },
      at: '2026-07-15T12:00:10.000Z',
      expectedHost: 'codex'
    });
    const finalizedConnectedContext = finalizeMeetingIntakeConnectedContext({
      root: temp,
      checkpointId: preparedConnectedContext.checkpoint.id,
      expectedHost: 'codex'
    });
    const replayedConnectedContext = finalizeMeetingIntakeConnectedContext({
      root: temp,
      checkpointId: preparedConnectedContext.checkpoint.id,
      expectedHost: 'codex'
    });
    const connectedSnapshotFile = path.join(temp, finalizedConnectedContext.snapshotPath);
    const connectedDurableContents = [
      finalizedConnectedContext.snapshotPath,
      finalizedConnectedContext.checkpointPath,
      finalizedConnectedContext.runPath
    ].map((file) => fs.readFileSync(path.join(temp, file), 'utf8')).join('\n');
    const connectedAuthorities = new Map(
      finalizedConnectedContext.run.context.map((item) => [item.authority, item.status])
    );
    if (!incompleteContextRejected
      || !forwardBindingRejected
      || !bindingOverwriteRejected
      || !bindingOverlapRejected
      || preparedConnectedContext.checkpoint.$contract
        !== 'soter://contracts/operation-plan-checkpoint/v2'
      || preparedConnectedContext.currentCall?.capability.id !== 'crm.records.read'
      || preparedConnectedContext.currentCall?.arguments?.data?.data_source_urls?.length !== 1
      || connectedContextTranscript.currentCall?.capability.id !== 'meeting.transcript.read'
      || connectedContextTranscript.currentCall?.arguments?.id !== 'context-selftest'
      || connectedContextMeeting.currentCall?.capability.id !== 'crm.records.read'
      || connectedContextMeeting.currentCall?.arguments?.data?.params?.[0]
        !== connectedContextRecording
      || connectedContextOrganization.checkpoint.currentStepId
        !== 'step.context-organizations'
      || connectedContextOrganization.currentCall?.arguments?.data?.params?.[0]
        !== contextOrganizationUri
      || connectedContextOrganization.checkpoint.steps[3]
        ?.bindingResolutions[0]?.sourceOutputFingerprint
        !== connectedContextOrganization.checkpoint.steps[2]?.outputFingerprint
      || connectedContextProject.checkpoint.currentStepId !== 'step.context-projects'
      || connectedContextProject.currentCall?.arguments?.data?.params?.[0]
        !== contextProjectUri
      || connectedContextTask.checkpoint.currentStepId !== 'step.context-tasks'
      || connectedContextTask.currentCall?.arguments?.data?.params?.[0]
        !== contextTaskUri
      || completedConnectedContext.checkpoint.state !== 'completed'
      || completedConnectedContext.checkpoint.result?.stepResults?.length !== 6
      || finalizedConnectedContext.snapshot.containment !== 'connected'
      || finalizedConnectedContext.snapshot.entries.length !== 6
      || finalizedConnectedContext.run.lifecycleState !== 'paused'
      || connectedAuthorities.get('authority.crm.definition') !== 'declared'
      || connectedAuthorities.get('authority.crm.instance') !== 'loaded'
      || connectedAuthorities.get('authority.otter.provider') !== 'loaded'
      || connectedAuthorities.get('authority.notion.provider') !== 'declared'
      || replayedConnectedContext.snapshotPath !== finalizedConnectedContext.snapshotPath
      || fingerprintJson(replayedConnectedContext.snapshot)
        !== fingerprintJson(finalizedConnectedContext.snapshot)
      || (process.platform !== 'win32'
        && (fs.statSync(connectedSnapshotFile).mode & 0o777) !== 0o600)
      || [
        contextPolicyMarker,
        contextTranscriptMarker,
        contextMeetingMarker,
        contextOrganizationMarker,
        contextProjectMarker,
        contextTaskMarker
      ]
        .some((marker) => connectedDurableContents.includes(marker))) {
      failures.push('connected context did not preserve bounded sources, exact identities, private durable recovery, and honest authority state');
    }
    const unboundSnapshot = structuredClone(finalizedConnectedContext.snapshot);
    unboundSnapshot.id = 'context.meeting-intake.connected.unbound-selftest';
    unboundSnapshot.entries[0].value.unboundMutation = true;
    const unboundContextUpdates = [...new Set(
      finalizedConnectedContext.snapshot.entries.map((entry) => entry.authority)
    )].map((authority) => {
      const current = finalizedConnectedContext.run.context.find((item) => {
        return item.authority === authority;
      });
      return {
        authority,
        status: current.status,
        provenance: current.provenance,
        freshness: current.freshness
      };
    });
    let unboundSnapshotRejected = false;
    try {
      commitDurableContextSnapshot({
        root: temp,
        checkpointId: preparedConnectedContext.checkpoint.id,
        snapshot: unboundSnapshot,
        contextUpdates: unboundContextUpdates,
        checkpointDetails: 'Reject a snapshot value that is not the normalized plan output.',
        expectedHost: 'codex'
      });
    } catch (error) {
      unboundSnapshotRejected = error.message.includes('normalized operation-plan output');
    }
    if (!unboundSnapshotRejected
      || fs.existsSync(path.join(
        temp,
        '.soter/state/context-snapshots/context.meeting-intake.connected.unbound-selftest.json'
      ))) {
      failures.push('Core accepted context that was not mechanically bound to normalized plan output');
    }
    const mismatchContextRunPath = 'soter/fixtures/meeting-intake/mismatch-context-selftest.run.json';
    const mismatchContextRun = structuredClone(connectedContextRun);
    mismatchContextRun.id = 'run.meeting-intake.mismatch-context-selftest';
    writeJson(path.join(temp, mismatchContextRunPath), mismatchContextRun);
    const preparedMismatchContext = await prepareMeetingIntakeConnectedContext({
      root: temp,
      lockPath,
      runPath: mismatchContextRunPath,
      snapshotId: 'context.meeting-intake.connected.mismatch-selftest',
      meetingId: 'meeting.mismatch-context-selftest',
      recordingUri: connectedContextRecording,
      at: '2026-07-15T12:00:08.000Z',
      expectedHost: 'codex'
    });
    const mismatchTranscriptCall = await completeDurableOperationPlanExecution({
      root: temp,
      checkpointId: preparedMismatchContext.checkpoint.id,
      callId: preparedMismatchContext.currentCall.id,
      response: contextPolicyResponse,
      at: '2026-07-15T12:00:09.000Z',
      expectedHost: 'codex'
    });
    const mismatchMeetingCall = await completeDurableOperationPlanExecution({
      root: temp,
      checkpointId: preparedMismatchContext.checkpoint.id,
      callId: mismatchTranscriptCall.currentCall.id,
      response: contextTranscriptResponse,
      at: '2026-07-15T12:00:10.000Z',
      expectedHost: 'codex'
    });
    const completedMismatchContext = await completeDurableOperationPlanExecution({
      root: temp,
      checkpointId: preparedMismatchContext.checkpoint.id,
      callId: mismatchMeetingCall.currentCall.id,
      response: {
        structuredContent: {
          result: {
            results: [{
              __soterType: 'meeting',
              __soterId: 'https://app.notion.com/mismatch-context-meeting',
              __soterFields: JSON.stringify({
                title: 'Mismatched connected context',
                meetingType: 'Project Sync',
                recordingUri: 'https://otter.ai/u/a-different-meeting',
                organizationUris: '[]',
                participantIds: '[]'
              })
            }],
            has_more: false
          }
        }
      },
      at: '2026-07-15T12:00:11.000Z',
      expectedHost: 'codex'
    });
    let mismatchedMeetingRejected = false;
    try {
      finalizeMeetingIntakeConnectedContext({
        root: temp,
        checkpointId: preparedMismatchContext.checkpoint.id,
        expectedHost: 'codex'
      });
    } catch (error) {
      mismatchedMeetingRejected = error.message.includes('completed operation plan');
    }
    if (!mismatchedMeetingRejected
      || completedMismatchContext.checkpoint.state !== 'failed'
      || completedMismatchContext.currentCall !== null
      || completedMismatchContext.checkpoint.steps[2]?.state !== 'failed'
      || completedMismatchContext.checkpoint.steps.slice(3)
        .some((step) => step.state !== 'pending' || step.call !== null)
      || fs.existsSync(path.join(
        temp,
        '.soter/state/context-snapshots/context.meeting-intake.connected.mismatch-selftest.json'
      ))) {
      failures.push('connected context accepted a CRM meeting that did not match the selected recording identity');
    }
    const emptyContextRunPath = 'soter/fixtures/meeting-intake/empty-context-selftest.run.json';
    const emptyContextRun = structuredClone(connectedContextRun);
    emptyContextRun.id = 'run.meeting-intake.empty-context-selftest';
    writeJson(path.join(temp, emptyContextRunPath), emptyContextRun);
    const preparedEmptyContext = await prepareMeetingIntakeConnectedContext({
      root: temp,
      lockPath,
      runPath: emptyContextRunPath,
      snapshotId: 'context.meeting-intake.connected.empty-selftest',
      meetingId: 'meeting.empty-context-selftest',
      recordingUri: connectedContextRecording,
      at: '2026-07-15T12:00:12.000Z',
      expectedHost: 'codex'
    });
    const emptyContextTranscript = await completeDurableOperationPlanExecution({
      root: temp,
      checkpointId: preparedEmptyContext.checkpoint.id,
      callId: preparedEmptyContext.currentCall.id,
      response: contextPolicyResponse,
      at: '2026-07-15T12:00:13.000Z',
      expectedHost: 'codex'
    });
    const emptyContextMeeting = await completeDurableOperationPlanExecution({
      root: temp,
      checkpointId: preparedEmptyContext.checkpoint.id,
      callId: emptyContextTranscript.currentCall.id,
      response: contextTranscriptResponse,
      at: '2026-07-15T12:00:14.000Z',
      expectedHost: 'codex'
    });
    const completedEmptyContext = await completeDurableOperationPlanExecution({
      root: temp,
      checkpointId: preparedEmptyContext.checkpoint.id,
      callId: emptyContextMeeting.currentCall.id,
      response: {
        structuredContent: {
          result: {
            results: [{
              __soterType: 'meeting',
              __soterId: 'https://app.notion.com/empty-context-meeting',
              __soterFields: JSON.stringify({
                title: 'Meeting without related CRM records',
                meetingType: 'General',
                recordingUri: connectedContextRecording,
                organizationUris: '[]',
                participantIds: '[]'
              })
            }],
            has_more: false
          }
        }
      },
      at: '2026-07-15T12:00:15.000Z',
      expectedHost: 'codex'
    });
    const finalizedEmptyContext = finalizeMeetingIntakeConnectedContext({
      root: temp,
      checkpointId: preparedEmptyContext.checkpoint.id,
      expectedHost: 'codex'
    });
    if (completedEmptyContext.checkpoint.state !== 'completed'
      || completedEmptyContext.currentCall !== null
      || completedEmptyContext.checkpoint.steps.slice(3)
        .some((step) => step.state !== 'skipped'
          || step.call !== null
          || step.bindingResolutions[0]?.state !== 'empty')
      || finalizedEmptyContext.snapshot.entries.length !== 3
      || finalizedEmptyContext.snapshot.effectIds.length !== 3) {
      failures.push('empty output bindings emitted a broad provider read or produced false related context');
    }
    const missingRelationRunPath = 'soter/fixtures/meeting-intake/missing-relation-selftest.run.json';
    const missingRelationRun = structuredClone(connectedContextRun);
    missingRelationRun.id = 'run.meeting-intake.missing-relation-selftest';
    writeJson(path.join(temp, missingRelationRunPath), missingRelationRun);
    const missingOrganizationUri = 'https://app.notion.com/missing-bound-organization';
    const preparedMissingRelation = await prepareMeetingIntakeConnectedContext({
      root: temp,
      lockPath,
      runPath: missingRelationRunPath,
      snapshotId: 'context.meeting-intake.connected.missing-relation-selftest',
      meetingId: 'meeting.missing-relation-selftest',
      recordingUri: connectedContextRecording,
      at: '2026-07-15T12:00:16.000Z',
      expectedHost: 'codex'
    });
    const missingRelationTranscript = await completeDurableOperationPlanExecution({
      root: temp,
      checkpointId: preparedMissingRelation.checkpoint.id,
      callId: preparedMissingRelation.currentCall.id,
      response: contextPolicyResponse,
      at: '2026-07-15T12:00:17.000Z',
      expectedHost: 'codex'
    });
    const missingRelationMeeting = await completeDurableOperationPlanExecution({
      root: temp,
      checkpointId: preparedMissingRelation.checkpoint.id,
      callId: missingRelationTranscript.currentCall.id,
      response: contextTranscriptResponse,
      at: '2026-07-15T12:00:18.000Z',
      expectedHost: 'codex'
    });
    const missingRelationOrganization = await completeDurableOperationPlanExecution({
      root: temp,
      checkpointId: preparedMissingRelation.checkpoint.id,
      callId: missingRelationMeeting.currentCall.id,
      response: {
        structuredContent: {
          result: {
            results: [{
              __soterType: 'meeting',
              __soterId: 'https://app.notion.com/missing-relation-meeting',
              __soterFields: JSON.stringify({
                title: 'Meeting with a missing organization relation',
                meetingType: 'Project Sync',
                recordingUri: connectedContextRecording,
                organizationUris: JSON.stringify([missingOrganizationUri]),
                participantIds: '[]'
              })
            }],
            has_more: false
          }
        }
      },
      at: '2026-07-15T12:00:19.000Z',
      expectedHost: 'codex'
    });
    const completedMissingRelation = await completeDurableOperationPlanExecution({
      root: temp,
      checkpointId: preparedMissingRelation.checkpoint.id,
      callId: missingRelationOrganization.currentCall.id,
      response: {
        structuredContent: { result: { results: [], has_more: false } }
      },
      at: '2026-07-15T12:00:20.000Z',
      expectedHost: 'codex'
    });
    let missingRelationRejected = false;
    try {
      finalizeMeetingIntakeConnectedContext({
        root: temp,
        checkpointId: preparedMissingRelation.checkpoint.id,
        expectedHost: 'codex'
      });
    } catch (error) {
      missingRelationRejected = error.message.includes('every and only the records referenced');
    }
    if (!missingRelationRejected
      || missingRelationOrganization.currentCall?.arguments?.data?.params?.[0]
        !== missingOrganizationUri
      || completedMissingRelation.checkpoint.state !== 'completed'
      || completedMissingRelation.checkpoint.steps.slice(4)
        .some((step) => step.state !== 'skipped' || step.call !== null)
      || fs.existsSync(path.join(
        temp,
        '.soter/state/context-snapshots/context.meeting-intake.connected.missing-relation-selftest.json'
      ))) {
      failures.push('missing bound records were accepted as complete related context');
    }
    const blockedWritePlan = await prepareDurableOperationPlanExecution({
      root: temp,
      lockPath,
      runPath: 'soter/fixtures/meeting-intake/preflight.run.json',
      plan: {
        $contract: 'soter://contracts/operation-plan/v1',
        contractVersion: '1.0.0',
        id: 'plan.meeting-intake.blocked-write-selftest',
        runId: envelope.id,
        createdAt: '2026-07-15T12:00:04.000Z',
        mode: 'sequential',
        failurePolicy: 'stop',
        reason: 'Prove that a sequential plan cannot grant itself confirmation-gated write authority.',
        steps: [{
          id: 'step.create-summary',
          capability: 'crm.records.create',
          authority: 'authority.crm.instance',
          providerImplementation: connectedProviders.notionWrites.id,
          input: {
            recordType: 'meeting-summary',
            deduplicationKey: 'selftest:operation-plan-blocked',
            fields: { title: 'Blocked plan summary' }
          },
          reason: 'Attempt one confirmation-gated write without an approval binding.'
        }]
      },
      at: '2026-07-15T12:00:04.000Z',
      expectedHost: 'codex'
    });
    if (blockedWritePlan.checkpoint.state !== 'blocked'
      || blockedWritePlan.currentCall !== null
      || blockedWritePlan.checkpoint.steps[0]?.call?.arguments !== null) {
      failures.push('operation plan widened authorization or emitted a blocked write request');
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
    const hostReadInput = {
      recordTypes: ['meeting'],
      ids: ['https://app.notion.com/meeting-selftest'],
      limit: 1
    };
    const preparedHostRead = await prepareHostToolCall({
      root: temp,
      lock,
      runId: 'run.meeting-intake.fixture',
      callId: 'toolcall.selftest.notion-read',
      capability: 'crm.records.read',
      authority: 'authority.crm.instance',
      providerImplementation: connectedProviders.notion.id,
      input: hostReadInput,
      at: FIXTURE_TIME
    });
    const rejectedMultiTargetRead = await prepareHostToolCall({
      root: temp,
      lock,
      runId: 'run.meeting-intake.fixture',
      callId: 'toolcall.selftest.notion-multi-target-read',
      capability: 'crm.records.read',
      authority: 'authority.crm.instance',
      providerImplementation: connectedProviders.notion.id,
      input: { recordTypes: ['meeting', 'task'], limit: 1 },
      at: FIXTURE_TIME
    });
    const completedHostRead = await completeHostToolCall({
      root: temp,
      lock,
      call: preparedHostRead.call,
      input: hostReadInput,
      response: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              results: [
                {
                  __soterType: 'meeting',
                  __soterId: 'https://app.notion.com/meeting-selftest',
                  __soterFields: JSON.stringify({
                    title: 'Selftest meeting',
                    meetingType: 'Project Sync',
                    recordingUri: null,
                    organizationUris: JSON.stringify(['https://app.notion.com/org-selftest']),
                    participantIds: JSON.stringify(['user.selftest'])
                  })
                }
              ],
              has_more: false,
              data_source_ids: ['selftest']
            })
          }
        ],
        isError: false,
        providerSecretMaterial: 'response-only-marker'
      },
      at: FIXTURE_TIME
    });
    if (preparedHostRead.call.state !== 'requested'
      || preparedHostRead.call.transport.server !== 'notion'
      || preparedHostRead.call.transport.operation !== 'query_data_sources'
      || preparedHostRead.call.transport.tool
        !== 'mcp__codex_apps__notion_notion_query_data_sources'
      || completedHostRead.call.state !== 'completed'
      || completedHostRead.output?.records[0]?.id
        !== 'https://app.notion.com/meeting-selftest'
      || !completedHostRead.output?.records[0]?.version?.startsWith('sha256:')
      || completedHostRead.output?.records[0]?.fields?.organizationUris?.[0]
        !== 'https://app.notion.com/org-selftest'
      || JSON.stringify(completedHostRead.call).includes('response-only-marker')) {
      failures.push('Notion read bridge did not preserve mapped native dispatch, typed normalization, and response minimization');
    }
    if (rejectedMultiTargetRead.call.state !== 'failed'
      || rejectedMultiTargetRead.call.transport.operation !== null
      || rejectedMultiTargetRead.call.transport.tool !== null
      || rejectedMultiTargetRead.call.error?.kind !== 'validation') {
      failures.push('Notion read bridge silently relied on plan-gated cross-data-source SQL');
    }
    const blockedHostWrite = await prepareHostToolCall({
      root: temp,
      lock,
      runId: 'run.meeting-intake.fixture',
      callId: 'toolcall.selftest.notion-write-blocked',
      capability: 'crm.records.create',
      authority: 'authority.crm.instance',
      providerImplementation: connectedProviders.notionWrites.id,
      input: {
        recordType: 'meeting-summary',
        deduplicationKey: 'selftest:mcp-blocked',
        fields: { title: 'Blocked host write' }
      },
      at: FIXTURE_TIME
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
    const otterReadInput = {
      meetingId: 'meeting.selftest',
      recordingUri: 'https://otter.ai/u/conversation_selftest'
    };
    const preparedOtterRead = await prepareHostToolCall({
      root: temp,
      lock,
      runId: 'run.meeting-intake.fixture',
      callId: 'toolcall.selftest.otter-read',
      capability: 'meeting.transcript.read',
      authority: 'authority.otter.provider',
      providerImplementation: connectedProviders.otter.id,
      input: otterReadInput,
      at: FIXTURE_TIME
    });
    const transcriptMarker = 'private-transcript-response-marker';
    const completedOtterRead = await completeHostToolCall({
      root: temp,
      lock,
      call: preparedOtterRead.call,
      input: otterReadInput,
      response: {
        structuredContent: {
          result: {
            speakers: [
              { id: 'speaker.selftest', displayName: 'Selftest speaker' }
            ],
            segments: [
              {
                speakerId: 'speaker.selftest',
                text: 'Selftest transcript segment.',
                startSeconds: 0
              }
            ],
            ignoredPrivateField: transcriptMarker
          }
        }
      },
      at: FIXTURE_TIME
    });
    if (preparedOtterRead.call.state !== 'requested'
      || preparedOtterRead.call.transport.operation !== 'fetch'
      || preparedOtterRead.call.transport.tool !== 'mcp__otter__fetch'
      || preparedOtterRead.call.arguments.id !== 'conversation_selftest'
      || completedOtterRead.call.state !== 'completed'
      || completedOtterRead.output?.meetingId !== 'meeting.selftest'
      || JSON.stringify(completedOtterRead).includes(transcriptMarker)) {
      failures.push('Otter MCP bridge did not enforce exact fetch translation and minimized normalization');
    }
    const invalidOtterRead = await prepareHostToolCall({
      root: temp,
      lock,
      runId: 'run.meeting-intake.fixture',
      callId: 'toolcall.selftest.otter-invalid-uri',
      capability: 'meeting.transcript.read',
      authority: 'authority.otter.provider',
      providerImplementation: connectedProviders.otter.id,
      input: {
        meetingId: 'meeting.selftest',
        recordingUri: 'https://example.com/not-an-otter-meeting'
      },
      at: FIXTURE_TIME
    });
    if (invalidOtterRead.call.state !== 'failed'
      || invalidOtterRead.call.arguments !== null
      || invalidOtterRead.call.error.kind !== 'validation') {
      failures.push('Otter MCP bridge emitted a provider request for an invalid recording URI');
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
    'CORE SELFTEST PASS: deterministic lock, typed fixture reads/writes, exact-scope approval, deduplication, expected-version conflicts, rollback, read-after-write verification, resumable fixed and bound sequential operation plans, bounded connected context finalization, resumable MCP host dispatch, exact-lock single and multi-step provider probes, schema drift rejection, connected readiness, expiry, honest states, and stale-lock detection.\n'
  );
  return true;
}
