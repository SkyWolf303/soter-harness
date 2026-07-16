import path from 'node:path';

import { listProviderDeclarations } from '../../core/capabilities.mjs';
import { fingerprintJson, readJson, resolveRepoPath } from '../../core/lib/canonical-json.mjs';
import { fingerprintLock } from '../../core/resolve.mjs';
import {
  commitDurableContextSnapshot,
  getExactDurableHostExecution,
  prepareDurableOperationPlanExecution
} from '../../core/service.mjs';

const PLAN_PREFIX = 'plan.meeting-intake.connected-context.';
const SNAPSHOT_PREFIX = 'context.meeting-intake.connected.';
const AUTOMATION_ID = 'automation.meeting-intake';
const STEP_IDS = [
  'step.context-definition-index',
  'step.context-transcript',
  'step.context-meeting-record',
  'step.context-organizations',
  'step.context-projects',
  'step.context-tasks'
];

function snapshotSuffix(snapshotId) {
  if (typeof snapshotId !== 'string'
    || !snapshotId.startsWith(SNAPSHOT_PREFIX)
    || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(snapshotId.slice(SNAPSHOT_PREFIX.length))) {
    throw new Error(
      'Connected meeting-intake snapshot ID must start with ' + SNAPSHOT_PREFIX
        + ' and end in a safe unique suffix.'
    );
  }
  return snapshotId.slice(SNAPSHOT_PREFIX.length);
}

function snapshotIdFromPlan(planId) {
  if (typeof planId !== 'string' || !planId.startsWith(PLAN_PREFIX)) {
    throw new Error('Checkpoint is not a connected meeting-intake context plan.');
  }
  const suffix = planId.slice(PLAN_PREFIX.length);
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(suffix)) {
    throw new Error('Connected meeting-intake context plan has an unsafe suffix.');
  }
  return SNAPSHOT_PREFIX + suffix;
}

function selectedAuthority(lock, role, subject) {
  const matches = lock.authorities.filter((item) => {
    return item.role === role && item.subject === subject;
  });
  if (matches.length !== 1) {
    throw new Error(
      'Expected one ' + role + ' authority for ' + subject + '; found ' + matches.length + '.'
    );
  }
  return matches[0].id;
}

function connectedProvider(root, lock, capability) {
  const binding = lock.bindings.find((item) => item.capability === capability);
  if (!binding) throw new Error('No resolved binding for ' + capability + '.');
  const matches = listProviderDeclarations(root).filter((provider) => {
    return provider.pack === binding.providerPack
      && provider.containment === 'connected'
      && provider.capabilities.some((item) => {
        return item.id === capability && item.version === binding.capabilityVersion;
      });
  });
  if (matches.length !== 1) {
    throw new Error(
      'Expected one connected provider for ' + capability + '; found ' + matches.length + '.'
    );
  }
  return matches[0].id;
}

function assertSelectedAutomation(lock, run) {
  const matches = lock.packs.filter((pack) => pack.id === AUTOMATION_ID);
  if (matches.length !== 1
    || matches[0].layer !== 'automation'
    || run?.automation?.id !== AUTOMATION_ID
    || run.automation.version !== matches[0].version) {
    throw new Error(
      'Connected meeting-intake context requires an exact run selecting '
        + AUTOMATION_ID + '.'
    );
  }
}

function sameJson(left, right) {
  return fingerprintJson(left) === fingerprintJson(right);
}

export function createMeetingIntakeConnectedContextPlan({
  root,
  lock,
  runId,
  snapshotId,
  meetingId,
  recordingUri,
  createdAt
}) {
  const resolvedRoot = path.resolve(root);
  const suffix = snapshotSuffix(snapshotId);
  const definitionAuthority = selectedAuthority(lock, 'definition', 'crm.records');
  const instanceAuthority = selectedAuthority(lock, 'instance', 'crm.records');
  const transcriptAuthority = selectedAuthority(lock, 'provider', 'meeting.transcript');
  const crmProvider = connectedProvider(resolvedRoot, lock, 'crm.records.read');
  const transcriptProvider = connectedProvider(
    resolvedRoot,
    lock,
    'meeting.transcript.read'
  );
  return {
    $contract: 'soter://contracts/operation-plan/v2',
    contractVersion: '2.0.0',
    id: PLAN_PREFIX + suffix,
    runId,
    createdAt,
    mode: 'sequential',
    failurePolicy: 'stop',
    reason: 'Load the bounded definition index, exact transcript, matching CRM meeting, and only the organization, project, and task records referenced by prior normalized outputs.',
    steps: [
      {
        id: STEP_IDS[0],
        capability: 'crm.records.read',
        authority: definitionAuthority,
        providerImplementation: crmProvider,
        input: { recordTypes: ['policy'], limit: 25 },
        inputBindings: [],
        reason: 'Load the bounded configured policy index without treating row metadata as policy page content.'
      },
      {
        id: STEP_IDS[1],
        capability: 'meeting.transcript.read',
        authority: transcriptAuthority,
        providerImplementation: transcriptProvider,
        input: { meetingId, recordingUri },
        inputBindings: [],
        reason: 'Load the exact user-selected transcript through its canonical recording URI.'
      },
      {
        id: STEP_IDS[2],
        capability: 'crm.records.read',
        authority: instanceAuthority,
        providerImplementation: crmProvider,
        input: {
          recordTypes: ['meeting'],
          filters: { recordingUri },
          limit: 2
        },
        inputBindings: [],
        reason: 'Resolve exactly one CRM meeting record by the same canonical recording URI.'
      },
      {
        id: STEP_IDS[3],
        capability: 'crm.records.read',
        authority: instanceAuthority,
        providerImplementation: crmProvider,
        input: { recordTypes: ['organization'], limit: 100 },
        inputBindings: [{
          id: 'binding.context-organization-uris',
          sourceStepId: STEP_IDS[2],
          sourcePath: ['records', '*', 'fields', 'organizationUris'],
          targetPath: ['ids'],
          transform: 'unique-string-list',
          onEmpty: 'skip-step'
        }],
        reason: 'Read only organizations referenced by the normalized selected meeting.'
      },
      {
        id: STEP_IDS[4],
        capability: 'crm.records.read',
        authority: instanceAuthority,
        providerImplementation: crmProvider,
        input: { recordTypes: ['project'], limit: 100 },
        inputBindings: [{
          id: 'binding.context-project-uris',
          sourceStepId: STEP_IDS[3],
          sourcePath: ['records', '*', 'fields', 'projectUris'],
          targetPath: ['ids'],
          transform: 'unique-string-list',
          onEmpty: 'skip-step'
        }],
        reason: 'Read only projects referenced by the resolved organizations.'
      },
      {
        id: STEP_IDS[5],
        capability: 'crm.records.read',
        authority: instanceAuthority,
        providerImplementation: crmProvider,
        input: { recordTypes: ['task'], limit: 100 },
        inputBindings: [{
          id: 'binding.context-task-uris',
          sourceStepId: STEP_IDS[4],
          sourcePath: ['records', '*', 'fields', 'taskUris'],
          targetPath: ['ids'],
          transform: 'unique-string-list',
          onEmpty: 'skip-step'
        }],
        reason: 'Read only tasks referenced by the resolved projects.'
      }
    ]
  };
}

export function assertMeetingIntakeConnectedContextPlan(plan) {
  const snapshotId = snapshotIdFromPlan(plan.id);
  if (plan.$contract !== 'soter://contracts/operation-plan/v2'
    || plan.contractVersion !== '2.0.0'
    || plan.steps.length !== STEP_IDS.length
    || plan.steps.some((step, index) => step.id !== STEP_IDS[index])) {
    throw new Error('Connected meeting-intake context plan does not preserve its required source order.');
  }
  const [definition, transcript, meeting, organizations, projects, tasks] = plan.steps;
  if (definition.capability !== 'crm.records.read'
    || !sameJson(definition.input, { recordTypes: ['policy'], limit: 25 })
    || !sameJson(definition.inputBindings, [])
    || transcript.capability !== 'meeting.transcript.read'
    || !sameJson(transcript.inputBindings, [])
    || meeting.capability !== 'crm.records.read'
    || !sameJson(meeting.input, {
      recordTypes: ['meeting'],
      filters: { recordingUri: transcript.input.recordingUri },
      limit: 2
    })
    || !sameJson(meeting.inputBindings, [])
    || !sameJson(organizations.input, { recordTypes: ['organization'], limit: 100 })
    || !sameJson(organizations.inputBindings, [{
      id: 'binding.context-organization-uris',
      sourceStepId: STEP_IDS[2],
      sourcePath: ['records', '*', 'fields', 'organizationUris'],
      targetPath: ['ids'],
      transform: 'unique-string-list',
      onEmpty: 'skip-step'
    }])
    || !sameJson(projects.input, { recordTypes: ['project'], limit: 100 })
    || !sameJson(projects.inputBindings, [{
      id: 'binding.context-project-uris',
      sourceStepId: STEP_IDS[3],
      sourcePath: ['records', '*', 'fields', 'projectUris'],
      targetPath: ['ids'],
      transform: 'unique-string-list',
      onEmpty: 'skip-step'
    }])
    || !sameJson(tasks.input, { recordTypes: ['task'], limit: 100 })
    || !sameJson(tasks.inputBindings, [{
      id: 'binding.context-task-uris',
      sourceStepId: STEP_IDS[4],
      sourcePath: ['records', '*', 'fields', 'taskUris'],
      targetPath: ['ids'],
      transform: 'unique-string-list',
      onEmpty: 'skip-step'
    }])
    || transcript.input.meetingId === undefined) {
    throw new Error('Connected meeting-intake context plan inputs do not preserve exact source identity.');
  }
  return {
    snapshotId,
    definition,
    transcript,
    meeting,
    organizations,
    projects,
    tasks
  };
}

function completedStep(checkpoint, id) {
  const step = checkpoint.steps.find((item) => item.id === id);
  if (!step || step.state !== 'completed' || !step.call || !step.output) {
    throw new Error('Connected context source ' + id + ' is not completed.');
  }
  return step;
}

function assertDefinitionOutput(step) {
  if (!Array.isArray(step.output.records)
    || step.output.records.length < 1
    || step.output.records.some((record) => record.type !== 'policy')) {
    throw new Error('Connected context requires at least one typed policy index record.');
  }
}

function assertTranscriptOutput(step, planStep) {
  const output = step.output;
  const speakerIds = new Set((output.speakers || []).map((speaker) => speaker.id));
  if (output.meetingId !== planStep.input.meetingId
    || !Array.isArray(output.speakers)
    || output.speakers.length < 1
    || !Array.isArray(output.segments)
    || output.segments.length < 1
    || output.segments.some((segment) => !speakerIds.has(segment.speakerId))) {
    throw new Error('Connected context transcript is empty, mismatched, or references unknown speakers.');
  }
}

function assertMeetingOutput(step, planStep) {
  const records = step.output.records;
  if (!Array.isArray(records)
    || records.length !== 1
    || records[0].type !== 'meeting'
    || records[0].fields?.recordingUri !== planStep.input.filters.recordingUri) {
    throw new Error(
      'Connected context requires exactly one CRM meeting record matching the selected recording URI.'
    );
  }
}

function terminalRelatedStep(checkpoint, id, recordType) {
  const step = checkpoint.steps.find((item) => item.id === id);
  if (!step) throw new Error('Connected related-context source is missing: ' + id + '.');
  if (step.state === 'skipped') {
    if (step.call !== null
      || step.output !== null
      || !Array.isArray(step.resolvedInput?.ids)
      || step.resolvedInput.ids.length !== 0
      || step.bindingResolutions.length !== 1
      || step.bindingResolutions[0].state !== 'empty') {
      throw new Error('Connected related-context source ' + id + ' has invalid empty state.');
    }
    return null;
  }
  if (step.state !== 'completed' || !step.call || !step.output) {
    throw new Error('Connected related-context source ' + id + ' is not terminal.');
  }
  const requestedIds = step.resolvedInput?.ids;
  const records = step.output.records;
  const recordIds = Array.isArray(records) ? records.map((record) => record.id) : [];
  if (!Array.isArray(requestedIds)
    || requestedIds.length < 1
    || !Array.isArray(records)
    || records.some((record) => record.type !== recordType)
    || new Set(recordIds).size !== recordIds.length
    || !sameJson([...recordIds].sort(), [...requestedIds].sort())) {
    throw new Error(
      'Connected related-context source ' + id
        + ' must return every and only the records referenced by its bound input.'
    );
  }
  return step;
}

function freshnessState(root, capability, observedAt, at) {
  const contract = readJson(path.join(root, 'soter', 'capabilities', capability + '.json'));
  const maxAge = contract.freshness.maxAgeSeconds;
  if (maxAge === null) return 'unknown';
  const age = (Date.parse(at) - Date.parse(observedAt)) / 1000;
  if (!Number.isFinite(age) || age < 0) return 'unknown';
  return age <= maxAge ? 'passed' : 'stale';
}

function snapshotEntry({ root, id, subject, role, step, at }) {
  return {
    id,
    subject,
    authority: step.call.authority,
    role,
    capability: step.call.capability.id,
    providerPack: step.call.provider.pack,
    providerImplementation: step.call.provider.implementation,
    providerVersion: step.call.provider.version,
    observedAt: step.output.observedAt,
    freshness: freshnessState(root, step.call.capability.id, step.output.observedAt, at),
    provenance: step.output.provenance,
    valueFingerprint: step.outputFingerprint,
    value: step.output
  };
}

function effectId(call) {
  return 'effect.' + call.id.slice('toolcall.'.length);
}

function freshnessRollup(entries) {
  if (entries.some((entry) => entry.freshness === 'stale')) return 'stale';
  if (entries.some((entry) => entry.freshness === 'unknown')) return 'unknown';
  return 'passed';
}

function contextUpdatesForEntries(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const current = grouped.get(entry.authority) || [];
    current.push(entry);
    grouped.set(entry.authority, current);
  }
  return [...grouped.entries()].map(([authority, authorityEntries]) => {
    const definition = authorityEntries.every((entry) => entry.role === 'definition');
    const freshness = freshnessRollup(authorityEntries);
    const providers = [...new Set(
      authorityEntries.map((entry) => entry.providerImplementation)
    )].sort();
    const values = authorityEntries.map((entry) => ({
      id: entry.id,
      fingerprint: entry.valueFingerprint
    })).sort((left, right) => left.id.localeCompare(right.id, 'en'));
    return {
      authority,
      status: definition ? 'declared' : (freshness === 'stale' ? 'stale' : 'loaded'),
      provenance: (definition ? 'index:' : '')
        + providers.join('+') + ':set:' + fingerprintJson(values),
      freshness
    };
  });
}

export async function prepareMeetingIntakeConnectedContext({
  root,
  lockPath,
  runPath,
  snapshotId,
  meetingId,
  recordingUri,
  at,
  expectedHost
}) {
  const resolvedRoot = path.resolve(root);
  const lock = readJson(resolveRepoPath(resolvedRoot, lockPath));
  const run = readJson(resolveRepoPath(resolvedRoot, runPath));
  assertSelectedAutomation(lock, run);
  const createdAt = at || new Date().toISOString();
  const plan = createMeetingIntakeConnectedContextPlan({
    root: resolvedRoot,
    lock,
    runId: run.id,
    snapshotId,
    meetingId,
    recordingUri,
    createdAt
  });
  return prepareDurableOperationPlanExecution({
    root: resolvedRoot,
    lockPath,
    runPath,
    plan,
    at: createdAt,
    expectedHost
  });
}

export function finalizeMeetingIntakeConnectedContext({
  root,
  checkpointId,
  expectedHost
}) {
  const resolvedRoot = path.resolve(root);
  const execution = getExactDurableHostExecution({
    root: resolvedRoot,
    checkpointId,
    expectedHost
  });
  const checkpoint = execution.checkpoint;
  if (checkpoint.kind !== 'operation-plan' || checkpoint.state !== 'completed') {
    throw new Error('Connected context can finalize only from a completed operation plan.');
  }
  const planShape = assertMeetingIntakeConnectedContextPlan(checkpoint.plan);
  const definition = completedStep(checkpoint, STEP_IDS[0]);
  const transcript = completedStep(checkpoint, STEP_IDS[1]);
  const meeting = completedStep(checkpoint, STEP_IDS[2]);
  const organizations = terminalRelatedStep(checkpoint, STEP_IDS[3], 'organization');
  const projects = terminalRelatedStep(checkpoint, STEP_IDS[4], 'project');
  const tasks = terminalRelatedStep(checkpoint, STEP_IDS[5], 'task');
  assertDefinitionOutput(definition);
  assertTranscriptOutput(transcript, planShape.transcript);
  assertMeetingOutput(meeting, planShape.meeting);

  const lock = readJson(resolveRepoPath(resolvedRoot, checkpoint.configurationLock.path));
  if (checkpoint.configurationLock.fingerprint !== fingerprintLock(lock)
    || checkpoint.graphFingerprint !== lock.graphFingerprint) {
    throw new Error('Connected context checkpoint no longer matches its exact lock and graph.');
  }
  assertSelectedAutomation(lock, execution.run);
  const expectedBindings = {
    definitionAuthority: selectedAuthority(lock, 'definition', 'crm.records'),
    instanceAuthority: selectedAuthority(lock, 'instance', 'crm.records'),
    transcriptAuthority: selectedAuthority(lock, 'provider', 'meeting.transcript'),
    crmProvider: connectedProvider(resolvedRoot, lock, 'crm.records.read'),
    transcriptProvider: connectedProvider(
      resolvedRoot,
      lock,
      'meeting.transcript.read'
    )
  };
  if (definition.call.authority !== expectedBindings.definitionAuthority
    || definition.call.provider.implementation !== expectedBindings.crmProvider
    || transcript.call.authority !== expectedBindings.transcriptAuthority
    || transcript.call.provider.implementation !== expectedBindings.transcriptProvider
    || meeting.call.authority !== expectedBindings.instanceAuthority
    || meeting.call.provider.implementation !== expectedBindings.crmProvider
    || [planShape.organizations, planShape.projects, planShape.tasks].some((step) => {
      return step.authority !== expectedBindings.instanceAuthority
        || step.providerImplementation !== expectedBindings.crmProvider;
    })) {
    throw new Error('Connected context plan does not match the resolved source bindings and authorities.');
  }
  const createdAt = checkpoint.updatedAt;
  const entries = [
    snapshotEntry({
      root: resolvedRoot,
      id: 'context.crm.definition-index',
      subject: 'crm.records',
      role: 'definition',
      step: definition,
      at: createdAt
    }),
    snapshotEntry({
      root: resolvedRoot,
      id: 'context.meeting.transcript',
      subject: 'meeting.transcript',
      role: 'provider',
      step: transcript,
      at: createdAt
    }),
    snapshotEntry({
      root: resolvedRoot,
      id: 'context.crm.meeting',
      subject: 'crm.records',
      role: 'instance',
      step: meeting,
      at: createdAt
    }),
    ...(organizations ? [snapshotEntry({
      root: resolvedRoot,
      id: 'context.crm.organizations',
      subject: 'crm.records',
      role: 'instance',
      step: organizations,
      at: createdAt
    })] : []),
    ...(projects ? [snapshotEntry({
      root: resolvedRoot,
      id: 'context.crm.projects',
      subject: 'crm.records',
      role: 'instance',
      step: projects,
      at: createdAt
    })] : []),
    ...(tasks ? [snapshotEntry({
      root: resolvedRoot,
      id: 'context.crm.tasks',
      subject: 'crm.records',
      role: 'instance',
      step: tasks,
      at: createdAt
    })] : [])
  ];
  const completedSources = [
    definition,
    transcript,
    meeting,
    organizations,
    projects,
    tasks
  ].filter(Boolean);
  const snapshot = {
    $contract: 'soter://contracts/context-snapshot/v1',
    contractVersion: '1.0.0',
    id: planShape.snapshotId,
    runId: checkpoint.plan.runId,
    createdAt,
    configurationLockFingerprint: checkpoint.configurationLock.fingerprint,
    graphFingerprint: checkpoint.graphFingerprint,
    containment: 'connected',
    entries,
    effectIds: completedSources.map((step) => effectId(step.call)),
    privacy: {
      scope: 'private',
      redactions: [
        'Provider credentials, raw host responses, and secret references are excluded.',
        'Policy rows are an index only; policy page bodies are not loaded by this snapshot.',
        'Organization, project, and task reads follow only normalized relation URIs; absent relations emit no provider request.',
        'Meeting participant identifiers remain references only and are not treated as CRM contact record URIs.'
      ]
    }
  };
  const contextUpdates = contextUpdatesForEntries(entries);
  return commitDurableContextSnapshot({
    root: resolvedRoot,
    checkpointId,
    snapshot,
    contextUpdates,
    checkpointDetails: 'Automation assembled the bounded connected definition index, exact transcript, exact CRM meeting, and any reference-bound organization, project, and task records through Core, then paused before policy-body loading, participant resolution, or writes.',
    expectedHost
  });
}
