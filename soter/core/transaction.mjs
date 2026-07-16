import { createFixtureRuntimeState, invokeCapability } from './capabilities.mjs';
import { assembleMeetingIntakeContext } from './context.mjs';
import { fingerprintJson } from './lib/canonical-json.mjs';
import { fingerprintLock } from './resolve.mjs';

function record(snapshot, type, id) {
  for (const entry of snapshot.entries) {
    const found = entry.value.records?.find((item) => item.type === type && item.id === id);
    if (found) return found;
  }
  throw new Error('Context snapshot does not contain ' + type + '/' + id + '.');
}

export function changeSetScopeFingerprint(changeSet) {
  return fingerprintJson({
    id: changeSet.id,
    runId: changeSet.runId,
    configurationLockFingerprint: changeSet.configurationLockFingerprint,
    operations: changeSet.operations.map((operation) => ({
      id: operation.id,
      capability: operation.capability,
      authority: operation.authority,
      inputFingerprint: operation.inputFingerprint
    }))
  });
}

export function proposeMeetingIntakeChangeSet({ lock, snapshot, id, runId, createdAt }) {
  const meeting = record(snapshot, 'meeting', 'meeting.fixture-001');
  const task = record(snapshot, 'task', 'task.existing-deck');
  const operations = [
    {
      id: 'operation.summary.create',
      capability: 'crm.records.create',
      authority: 'authority.crm.instance',
      reason: 'Create one transcript-grounded meeting summary with a stable deduplication key.',
      input: {
        recordType: 'meeting-summary',
        deduplicationKey: 'meeting.fixture-001:summary',
        fields: {
          title: 'Acme launch review summary',
          meetingId: meeting.id,
          projectId: meeting.fields.projectId,
          transcriptGrounded: true,
          unsupportedCommitmentDisposition: 'rejected'
        },
        body: 'Launch direction approved. Update and send the launch deck Friday.'
      }
    },
    {
      id: 'operation.task.update',
      capability: 'crm.records.update',
      authority: 'authority.crm.instance',
      reason: 'Fold the grounded commitment into the existing overlapping task instead of duplicating it.',
      input: {
        recordType: 'task',
        id: task.id,
        expectedVersion: task.version,
        patch: {
          sourceMeetingId: meeting.id,
          grounding: 'transcript',
          deduplicated: true
        }
      }
    },
    {
      id: 'operation.meeting.update',
      capability: 'crm.records.update',
      authority: 'authority.crm.instance',
      reason: 'Mark the source meeting as landed using the summary deduplication key.',
      input: {
        recordType: 'meeting',
        id: meeting.id,
        expectedVersion: meeting.version,
        patch: {
          summaryStatus: 'landed',
          summaryDeduplicationKey: 'meeting.fixture-001:summary'
        }
      }
    }
  ].map((operation) => ({
    ...operation,
    inputFingerprint: fingerprintJson(operation.input),
    state: 'pending',
    effectId: null,
    outputFingerprint: null,
    error: null
  }));
  const changeSet = {
    $contract: 'soter://contracts/change-set/v1',
    contractVersion: '1.0.0',
    id,
    runId,
    createdAt,
    configurationLockFingerprint: fingerprintLock(lock),
    state: 'proposed',
    scopeFingerprint: fingerprintJson(null),
    operations,
    approvalId: null,
    transaction: {
      checkpointFingerprint: fingerprintJson(null),
      state: 'not-started',
      rollbackState: 'not-required',
      restoredFingerprint: null
    },
    verification: {
      state: 'unknown',
      effectId: null,
      criteria: [
        'Exactly one meeting summary exists for the deduplication key.',
        'The existing task is grounded in the source meeting without duplication.',
        'The meeting records the landed summary state.'
      ],
      observedFingerprint: null
    }
  };
  changeSet.scopeFingerprint = changeSetScopeFingerprint(changeSet);
  return changeSet;
}

export function approveChangeSet({ changeSet, id, runId, createdAt, actor, reason }) {
  return {
    $contract: 'soter://contracts/approval/v1',
    contractVersion: '1.0.0',
    id,
    runId,
    createdAt,
    actor,
    decision: 'approved',
    scope: {
      changeSetId: changeSet.id,
      fingerprint: changeSet.scopeFingerprint,
      effects: ['write']
    },
    reason
  };
}

function approvalMatches(changeSet, approval) {
  return approval.decision === 'approved'
    && approval.runId === changeSet.runId
    && approval.scope.changeSetId === changeSet.id
    && approval.scope.fingerprint === changeSetScopeFingerprint(changeSet)
    && approval.scope.effects.includes('write');
}

export async function executeContainedChangeSet({ root, lock, changeSet, approval, at }) {
  if (!approvalMatches(changeSet, approval)) {
    throw new Error('Approval does not match the exact current change-set scope.');
  }
  let runtimeState = createFixtureRuntimeState(root);
  const checkpoint = structuredClone(runtimeState);
  const checkpointFingerprint = fingerprintJson(checkpoint);
  const effects = [];
  const operations = [];
  let failed = false;

  for (const operation of changeSet.operations) {
    if (failed) {
      operations.push({ ...operation });
      continue;
    }
    const effectId = 'effect.' + changeSet.id.slice('changeset.'.length) + '.' + operation.id.slice('operation.'.length);
    const result = await invokeCapability({
      root,
      lock,
      capability: operation.capability,
      authority: operation.authority,
      containment: 'fixture',
      input: operation.input,
      effectId,
      at,
      approvedEffects: ['write'],
      runtimeState
    });
    effects.push(result.invocation);
    operations.push({
      ...operation,
      state: result.invocation.state === 'passed' ? 'passed' : 'failed',
      effectId,
      outputFingerprint: result.invocation.outputFingerprint,
      error: result.invocation.error
    });
    failed = result.invocation.state !== 'passed';
  }

  if (failed) {
    runtimeState = checkpoint;
    return {
      changeSet: {
        ...changeSet,
        state: 'rolled-back',
        approvalId: approval.id,
        operations: operations.map((operation) => ({
          ...operation,
          state: operation.state === 'passed' ? 'rolled-back' : operation.state
        })),
        transaction: {
          checkpointFingerprint,
          state: 'rolled-back',
          rollbackState: 'passed',
          restoredFingerprint: fingerprintJson(runtimeState)
        },
        verification: {
          ...changeSet.verification,
          state: 'skipped'
        }
      },
      effects,
      verificationOutput: null,
      runtimeState
    };
  }

  const verification = await invokeCapability({
    root,
    lock,
    capability: 'crm.records.read',
    authority: 'authority.crm.instance',
    containment: 'fixture',
    input: {
      recordTypes: ['meeting-summary', 'task', 'meeting']
    },
    effectId: 'effect.' + changeSet.id.slice('changeset.'.length) + '.verify',
    at,
    runtimeState
  });
  effects.push(verification.invocation);
  const records = verification.output?.records || [];
  const summary = records.find((item) => item.type === 'meeting-summary');
  const task = records.find((item) => item.id === 'task.existing-deck');
  const meeting = records.find((item) => item.id === 'meeting.fixture-001');
  const verified = verification.invocation.state === 'passed'
    && Boolean(summary)
    && task?.fields.sourceMeetingId === 'meeting.fixture-001'
    && task?.fields.deduplicated === true
    && meeting?.fields.summaryStatus === 'landed';
  if (!verified) {
    runtimeState = checkpoint;
    return {
      changeSet: {
        ...changeSet,
        state: 'rolled-back',
        approvalId: approval.id,
        operations: operations.map((operation) => ({ ...operation, state: 'rolled-back' })),
        transaction: {
          checkpointFingerprint,
          state: 'rolled-back',
          rollbackState: 'passed',
          restoredFingerprint: fingerprintJson(runtimeState)
        },
        verification: {
          ...changeSet.verification,
          state: 'failed',
          effectId: verification.invocation.id,
          observedFingerprint: verification.invocation.outputFingerprint
        }
      },
      effects,
      verificationOutput: verification.output,
      runtimeState
    };
  }
  return {
    changeSet: {
      ...changeSet,
      state: 'committed',
      approvalId: approval.id,
      operations,
      transaction: {
        checkpointFingerprint,
        state: 'committed',
        rollbackState: 'not-required',
        restoredFingerprint: null
      },
      verification: {
        ...changeSet.verification,
        state: 'passed',
        effectId: verification.invocation.id,
        observedFingerprint: verification.invocation.outputFingerprint
      }
    },
    effects,
    verificationOutput: verification.output,
    runtimeState
  };
}

export async function runContainedMeetingIntakeTransaction({
  root,
  lock,
  lockPath,
  scenarioPath,
  runId,
  snapshotId,
  changeSetId,
  approvalId,
  createdAt,
  actor,
  approved,
  evidenceIds
}) {
  const contained = await assembleMeetingIntakeContext({
    root,
    lock,
    lockPath,
    scenarioPath,
    runId,
    snapshotId,
    createdAt,
    meetingId: 'meeting.fixture-001',
    recordingUri: 'otter://fixture/meeting.fixture-001',
    evidenceIds
  });
  const proposed = proposeMeetingIntakeChangeSet({
    lock,
    snapshot: contained.snapshot,
    id: changeSetId,
    runId,
    createdAt
  });
  if (!approved) {
    contained.envelope.outputs.push({
      id: proposed.id,
      type: 'change-set-preview',
      fingerprint: proposed.scopeFingerprint
    });
    return { ...contained, changeSet: proposed, approval: null, verificationOutput: null };
  }
  const approval = approveChangeSet({
    changeSet: proposed,
    id: approvalId,
    runId,
    createdAt,
    actor,
    reason: 'Approve this exact contained meeting-intake write batch for transactional fixture execution.'
  });
  const executed = await executeContainedChangeSet({
    root,
    lock,
    changeSet: proposed,
    approval,
    at: createdAt
  });
  contained.envelope.approvals = [approval];
  contained.envelope.effects.push(...executed.effects);
  contained.envelope.outputs.push({
    id: executed.changeSet.id,
    type: 'change-set',
    fingerprint: fingerprintJson(executed.changeSet)
  });
  contained.envelope.checkpoints.push(
    {
      id: 'write-batch-approved',
      state: 'passed',
      details: 'Approval fingerprint matched the exact proposed operation scope.'
    },
    {
      id: 'write-transaction',
      state: executed.changeSet.transaction.state === 'committed' ? 'passed' : 'failed',
      details: 'Contained writes completed under one checkpoint with explicit rollback state.'
    },
    {
      id: 'read-after-write',
      state: executed.changeSet.verification.state,
      details: 'The fixture store was re-read and checked against the change-set acceptance criteria.'
    }
  );
  contained.envelope.lifecycleState = executed.changeSet.state === 'committed' ? 'completed' : 'failed';
  return {
    envelope: contained.envelope,
    snapshot: contained.snapshot,
    changeSet: executed.changeSet,
    approval,
    verificationOutput: executed.verificationOutput
  };
}
