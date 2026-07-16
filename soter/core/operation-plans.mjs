import path from 'node:path';

import { validateJsonSchema } from '../kernel/verify.mjs';
import {
  completeHostToolCall,
  failHostToolCall,
  prepareHostToolCall
} from './host-tools.mjs';
import { fingerprintJson, readJson } from './lib/canonical-json.mjs';

function contractFailures(root, value, schemaPath, label) {
  const schema = readJson(path.join(root, schemaPath));
  const failures = validateJsonSchema(value, schema);
  if (failures.length) {
    throw new Error(
      label + ' does not satisfy its contract: '
        + failures.slice(0, 5).map((item) => item.path + ' ' + item.message).join('; ')
    );
  }
}

function idPart(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function operationPlanCallId(plan, step) {
  return 'toolcall.' + idPart(plan.id) + '.' + idPart(step.id);
}

function checkpointFingerprint(checkpoint) {
  const value = structuredClone(checkpoint);
  delete value.checkpointFingerprint;
  return fingerprintJson(value);
}

function expectedResult(steps) {
  return {
    outputFingerprints: steps.map((step) => ({
      stepId: step.id,
      fingerprint: step.outputFingerprint
    }))
  };
}

function sourceStep(checkpoint, runtimeStep) {
  return checkpoint.plan.steps.find((step) => step.id === runtimeStep.id);
}

function assertStepCall(root, checkpoint, runtimeStep, source) {
  if (!runtimeStep.call) {
    throw new Error('Operation plan step ' + runtimeStep.id + ' has no call record.');
  }
  contractFailures(
    root,
    runtimeStep.call,
    'soter/contracts/host-tool-call.schema.json',
    'Operation plan step call'
  );
  const call = runtimeStep.call;
  if (call.runId !== checkpoint.plan.runId
    || call.configurationLockFingerprint !== checkpoint.configurationLock.fingerprint
    || call.graphFingerprint !== checkpoint.graphFingerprint
    || fingerprintJson(call.host) !== fingerprintJson(checkpoint.host)
    || call.capability.id !== source.capability
    || call.authority !== source.authority
    || call.provider.implementation !== source.providerImplementation
    || call.inputFingerprint !== fingerprintJson(source.input)
    || runtimeStep.state !== call.state) {
    throw new Error('Operation plan step ' + runtimeStep.id + ' does not match its exact call.');
  }
  if (runtimeStep.state === 'completed') {
    if (!runtimeStep.output
      || runtimeStep.outputFingerprint !== fingerprintJson(runtimeStep.output)
      || runtimeStep.outputFingerprint !== call.outputFingerprint
      || runtimeStep.error !== null) {
      throw new Error('Completed operation plan step ' + runtimeStep.id + ' has inconsistent output state.');
    }
  } else if (runtimeStep.output !== null
    || runtimeStep.outputFingerprint !== null
    || fingerprintJson(runtimeStep.error) !== fingerprintJson(call.error)) {
    throw new Error('Open or failed operation plan step ' + runtimeStep.id + ' has inconsistent result state.');
  }
}

export function assertOperationPlanDocument(root, plan) {
  contractFailures(
    path.resolve(root),
    plan,
    'soter/contracts/operation-plan.schema.json',
    'Operation plan'
  );
  const ids = plan.steps.map((step) => step.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('Operation plan step identifiers must be unique.');
  }
  return plan;
}

export async function preflightOperationPlanSteps({ root, lock, plan, at }) {
  assertOperationPlanDocument(root, plan);
  for (const step of plan.steps) {
    let prepared;
    try {
      prepared = await prepareHostToolCall({
        root,
        lock,
        runId: plan.runId,
        callId: operationPlanCallId(plan, step),
        capability: step.capability,
        authority: step.authority,
        containment: 'connected',
        providerImplementation: step.providerImplementation,
        input: step.input,
        at,
        approvedEffects: []
      });
    } catch (error) {
      throw new Error(
        'Operation plan step ' + step.id + ' cannot be prepared: ' + error.message
      );
    }
    if (prepared.call.state === 'failed') {
      throw new Error(
        'Operation plan step ' + step.id + ' cannot be prepared: '
          + prepared.call.error.message
      );
    }
  }
  return plan;
}

export function assertOperationPlanCheckpoint(root, checkpoint) {
  const resolvedRoot = path.resolve(root);
  contractFailures(
    resolvedRoot,
    checkpoint,
    'soter/contracts/operation-plan-checkpoint.schema.json',
    'Operation plan checkpoint'
  );
  assertOperationPlanDocument(resolvedRoot, checkpoint.plan);
  if (checkpoint.checkpointFingerprint !== checkpointFingerprint(checkpoint)) {
    throw new Error('Operation plan checkpoint fingerprint does not match its durable contents.');
  }
  if (checkpoint.planFingerprint !== fingerprintJson(checkpoint.plan)
    || checkpoint.plan.runId !== checkpoint.run.id
    || checkpoint.steps.length !== checkpoint.plan.steps.length) {
    throw new Error('Operation plan checkpoint does not match its source plan and run.');
  }

  let completedPrefix = 0;
  while (checkpoint.steps[completedPrefix]?.state === 'completed') completedPrefix += 1;
  for (let index = 0; index < checkpoint.steps.length; index += 1) {
    const runtimeStep = checkpoint.steps[index];
    const source = checkpoint.plan.steps[index];
    if (runtimeStep.id !== source.id || runtimeStep.sequence !== index + 1) {
      throw new Error('Operation plan runtime steps do not preserve source order.');
    }
    if (runtimeStep.state === 'pending') {
      if (runtimeStep.call !== null
        || runtimeStep.output !== null
        || runtimeStep.outputFingerprint !== null
        || runtimeStep.error !== null) {
        throw new Error('Pending operation plan step ' + runtimeStep.id + ' contains execution state.');
      }
    } else {
      assertStepCall(resolvedRoot, checkpoint, runtimeStep, sourceStep(checkpoint, runtimeStep));
    }
  }

  const active = checkpoint.steps[completedPrefix] || null;
  const tail = active ? checkpoint.steps.slice(completedPrefix + 1) : [];
  if (tail.some((step) => step.state !== 'pending')) {
    throw new Error('Operation plan steps must execute sequentially without skipped work.');
  }
  if (!active) {
    if (checkpoint.state !== 'completed'
      || checkpoint.currentStepId !== null
      || fingerprintJson(checkpoint.result) !== fingerprintJson(expectedResult(checkpoint.steps))) {
      throw new Error('Completed operation plan checkpoint has inconsistent terminal state.');
    }
  } else if (checkpoint.state === 'requested') {
    if (active.state !== 'requested'
      || checkpoint.currentStepId !== active.id
      || checkpoint.result !== null) {
      throw new Error('Requested operation plan checkpoint does not identify exactly one active step.');
    }
  } else if (checkpoint.state === 'failed' || checkpoint.state === 'blocked') {
    if (active.state !== checkpoint.state
      || checkpoint.currentStepId !== null
      || checkpoint.result !== null) {
      throw new Error('Stopped operation plan checkpoint has inconsistent failure state.');
    }
  } else {
    throw new Error('Operation plan checkpoint state does not match its sequential steps.');
  }
  return checkpoint;
}

export function operationPlanCurrentCall(checkpoint) {
  if (checkpoint.state !== 'requested' || !checkpoint.currentStepId) return null;
  const step = checkpoint.steps.find((item) => item.id === checkpoint.currentStepId);
  return step?.call || null;
}

export function createOperationPlanCheckpoint({
  root,
  lock,
  lockPath,
  run,
  runSourcePath,
  runStatePath,
  plan,
  at
}) {
  assertOperationPlanDocument(root, plan);
  if (plan.runId !== run.id) {
    throw new Error('Operation plan does not belong to the supplied exact run.');
  }
  return {
    $contract: 'soter://contracts/operation-plan-checkpoint/v1',
    contractVersion: '1.0.0',
    id: 'checkpoint.' + plan.id,
    kind: 'operation-plan',
    createdAt: plan.createdAt,
    updatedAt: at,
    state: 'failed',
    configurationLock: {
      path: lockPath,
      fingerprint: fingerprintJson(lock)
    },
    graphFingerprint: lock.graphFingerprint,
    host: {
      id: lock.host.id,
      adapter: lock.host.adapter,
      version: lock.host.version
    },
    run: {
      id: run.id,
      sourcePath: runSourcePath,
      statePath: runStatePath,
      fingerprint: fingerprintJson(run)
    },
    plan: structuredClone(plan),
    planFingerprint: fingerprintJson(plan),
    steps: plan.steps.map((step, index) => ({
      id: step.id,
      sequence: index + 1,
      state: 'pending',
      call: null,
      output: null,
      outputFingerprint: null,
      error: null
    })),
    currentStepId: null,
    result: null,
    privacy: {
      scope: 'private',
      rawProviderResponsePersisted: false,
      hostCredentialValuesPersisted: false
    },
    checkpointFingerprint: fingerprintJson(null)
  };
}

export async function requestNextOperationPlanStep({ root, lock, checkpoint, at }) {
  const next = structuredClone(checkpoint);
  const runtimeStep = next.steps.find((step) => step.state === 'pending');
  if (!runtimeStep) {
    next.updatedAt = at;
    next.state = 'completed';
    next.currentStepId = null;
    next.result = expectedResult(next.steps);
    return next;
  }
  const source = sourceStep(next, runtimeStep);
  const callId = operationPlanCallId(next.plan, source);
  const prepared = await prepareHostToolCall({
    root,
    lock,
    runId: next.plan.runId,
    callId,
    capability: source.capability,
    authority: source.authority,
    containment: 'connected',
    providerImplementation: source.providerImplementation,
    input: source.input,
    at,
    approvedEffects: []
  });
  runtimeStep.call = prepared.call;
  runtimeStep.state = prepared.call.state;
  runtimeStep.error = structuredClone(prepared.call.error);
  next.updatedAt = at;
  next.state = prepared.call.state;
  next.currentStepId = prepared.call.state === 'requested' ? runtimeStep.id : null;
  next.result = null;
  return next;
}

function previousResponse(checkpoint, callId, response) {
  const step = checkpoint.steps.find((item) => item.call?.id === callId);
  if (!step || !step.call.responseFingerprint) return false;
  if (step.call.responseFingerprint !== fingerprintJson(response)) {
    throw new Error('Operation plan response does not match the exact completed step call.');
  }
  return true;
}

export async function completeOperationPlanStep({
  root,
  lock,
  checkpoint,
  callId,
  response,
  at
}) {
  assertOperationPlanCheckpoint(root, checkpoint);
  const currentCall = operationPlanCurrentCall(checkpoint);
  if (!currentCall || currentCall.id !== callId) {
    if (previousResponse(checkpoint, callId, response)) {
      return { checkpoint: structuredClone(checkpoint), idempotent: true };
    }
    throw new Error('Operation plan response does not match the exact current step call.');
  }
  const next = structuredClone(checkpoint);
  const runtimeStep = next.steps.find((step) => step.id === next.currentStepId);
  const source = sourceStep(next, runtimeStep);
  const completed = await completeHostToolCall({
    root,
    lock,
    call: runtimeStep.call,
    input: source.input,
    response,
    at
  });
  runtimeStep.call = completed.call;
  runtimeStep.state = completed.call.state;
  runtimeStep.output = completed.call.state === 'completed'
    ? structuredClone(completed.output)
    : null;
  runtimeStep.outputFingerprint = completed.call.state === 'completed'
    ? completed.call.outputFingerprint
    : null;
  runtimeStep.error = structuredClone(completed.call.error);
  next.updatedAt = at;
  next.currentStepId = null;
  next.result = null;
  if (completed.call.state !== 'completed') {
    next.state = completed.call.state;
    return { checkpoint: next, idempotent: false };
  }
  next.state = 'requested';
  return {
    checkpoint: await requestNextOperationPlanStep({ root, lock, checkpoint: next, at }),
    idempotent: false
  };
}

export function failOperationPlanStep({
  root,
  lock,
  checkpoint,
  callId,
  error,
  at
}) {
  assertOperationPlanCheckpoint(root, checkpoint);
  const currentCall = operationPlanCurrentCall(checkpoint);
  if (!currentCall || currentCall.id !== callId) {
    const previous = checkpoint.steps.find((step) => step.call?.id === callId);
    if (previous?.call.error?.kind === error.kind
      && previous.call.error.message === error.message) {
      return { checkpoint: structuredClone(checkpoint), idempotent: true };
    }
    throw new Error('Operation plan failure does not match the exact current step call.');
  }
  const next = structuredClone(checkpoint);
  const runtimeStep = next.steps.find((step) => step.id === next.currentStepId);
  const failed = failHostToolCall({
    root,
    lock,
    call: runtimeStep.call,
    error,
    at
  });
  runtimeStep.call = failed;
  runtimeStep.state = failed.state;
  runtimeStep.error = structuredClone(failed.error);
  next.updatedAt = at;
  next.state = failed.state;
  next.currentStepId = null;
  next.result = null;
  return { checkpoint: next, idempotent: false };
}
