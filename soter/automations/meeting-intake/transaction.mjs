import { invokeCapability } from '../../core/capabilities.mjs';
import { assembleMeetingIntakeContext } from '../../core/context.mjs';
import { fingerprintJson } from '../../core/lib/canonical-json.mjs';
import { fingerprintLock } from '../../core/resolve.mjs';
import {
  approveChangeSet,
  changeSetScopeFingerprint,
  executeContainedChangeSet
} from '../../core/transaction.mjs';

function records(snapshot, type) {
  const matches = [];
  for (const entry of snapshot.entries) {
    matches.push(...(entry.value.records || []).filter((item) => item.type === type));
  }
  return matches;
}

function singleRecord(snapshot, type) {
  const matches = records(snapshot, type);
  if (matches.length !== 1) {
    throw new Error(
      'Meeting-intake proposal requires exactly one bounded ' + type
        + ' candidate; found ' + matches.length + '.'
    );
  }
  return matches[0];
}

function singleTranscript(snapshot) {
  const matches = snapshot.entries
    .map((entry) => entry.value)
    .filter((value) => Array.isArray(value?.segments) && Array.isArray(value?.speakers));
  if (matches.length !== 1 || matches[0].segments.length < 1) {
    throw new Error(
      'Meeting-intake proposal requires exactly one non-empty bounded transcript; found '
        + matches.length + '.'
    );
  }
  return matches[0];
}

export function proposeMeetingIntakeChangeSet({ lock, snapshot, id, runId, createdAt }) {
  const meeting = singleRecord(snapshot, 'meeting');
  const task = singleRecord(snapshot, 'task');
  const transcript = singleTranscript(snapshot);
  const speakerNames = new Map(transcript.speakers.map((speaker) => {
    return [speaker.id, speaker.displayName];
  }));
  const transcriptText = transcript.segments.map((segment) => segment.text).join(' ');
  const taskTokens = task.fields.title.toLowerCase().split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4);
  if (taskTokens.some((token) => !transcriptText.toLowerCase().includes(token))) {
    throw new Error('The sole bounded task candidate is not textually grounded in the transcript fixture.');
  }
  const summaryBody = transcript.segments.map((segment) => {
    return (speakerNames.get(segment.speakerId) || segment.speakerId) + ': ' + segment.text;
  }).join('\n\n');
  const operations = [
    {
      id: 'operation.summary.create',
      capability: 'crm.records.create',
      authority: 'authority.crm.instance',
      reason: 'Create one transcript-grounded meeting summary attributed to the canonical recording.',
      input: {
        recordType: 'meeting-summary',
        deduplicationKey: meeting.fields.recordingUri,
        deduplicationFilter: {
          field: 'link',
          value: meeting.fields.recordingUri
        },
        fields: {
          title: meeting.fields.title + ' summary',
          documentType: 'Meeting Summary',
          description: transcriptText,
          link: meeting.fields.recordingUri
        },
        body: summaryBody
      }
    },
    {
      id: 'operation.task.update',
      capability: 'crm.records.update',
      authority: 'authority.crm.instance',
      reason: 'Classify the existing overlapping task as meeting-derived instead of creating a duplicate.',
      input: {
        recordType: 'task',
        id: task.id,
        expectedVersion: task.version,
        patch: {
          context: 'Meeting'
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
        'Exactly one meeting summary exists for the canonical recording link.',
        'The summary body and link remain attributable to the source transcript and recording.',
        'The existing overlapping task is classified as meeting-derived without duplication.'
      ],
      observedFingerprint: null
    }
  };
  changeSet.scopeFingerprint = changeSetScopeFingerprint(changeSet);
  return changeSet;
}

async function verifyContainedOutcome({ root, lock, changeSet, runtimeState, at }) {
  const verification = await invokeCapability({
    root,
    lock,
    capability: 'crm.records.read',
    authority: 'authority.crm.instance',
    containment: 'fixture',
    input: {
      recordTypes: [...new Set(changeSet.operations.map((operation) => {
        return operation.input.recordType;
      }))]
    },
    effectId: 'effect.' + changeSet.id.slice('changeset.'.length) + '.verify',
    at,
    runtimeState
  });
  const values = verification.output?.records || [];
  const summaryOperation = changeSet.operations.find((item) => {
    return item.id === 'operation.summary.create';
  });
  const taskOperation = changeSet.operations.find((item) => {
    return item.id === 'operation.task.update';
  });
  const summary = values.find((item) => {
    return item.type === 'meeting-summary'
      && item.deduplicationKey === summaryOperation?.input.deduplicationKey;
  });
  const task = values.find((item) => item.id === taskOperation?.input.id);
  return {
    invocation: verification.invocation,
    output: verification.output,
    passed: verification.invocation.state === 'passed'
      && Boolean(summary)
      && summary.fields.link === summaryOperation.input.fields.link
      && summary.body === summaryOperation.input.body
      && task?.fields.context === taskOperation.input.patch.context
  };
}

export function executeContainedMeetingIntakeChangeSet(args) {
  return executeContainedChangeSet({ ...args, verify: verifyContainedOutcome });
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
  const executed = await executeContainedMeetingIntakeChangeSet({
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
      details: 'The fixture store was re-read and checked against the Automation acceptance criteria.'
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
