import path from 'node:path';

import { validateJsonSchema } from '../kernel/verify.mjs';
import {
  completeHostToolCall,
  failHostToolCall,
  prepareHostToolCall
} from './host-tools.mjs';
import { containsCredentialMaterial } from './host-runtime.mjs';
import { fingerprintJson, readJson, repoRelativePath, resolveRepoPath } from './lib/canonical-json.mjs';
import {
  completeProviderProbeCall,
  failProviderProbeCall,
  prepareProviderProbeCall
} from './provider-probes.mjs';
import { fingerprintLock, lockMatchesResolution } from './resolve.mjs';
import {
  hasHostCallCheckpoint,
  hasRunState,
  listHostCallCheckpointDocuments,
  readHostCallCheckpoint,
  readRunState,
  writeHostCallCheckpoint,
  writeRunState
} from './runtime-state.mjs';

const EXECUTABLE_RUN_STATES = new Set(['effects-established', 'executing']);
const DURABLE_RUN_STATES = new Set(['effects-established', 'executing', 'paused']);

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

function exactLock(root, lockPath, expectedHost) {
  const resolvedRoot = path.resolve(root);
  const file = resolveRepoPath(resolvedRoot, lockPath);
  const lock = readJson(file);
  contractFailures(resolvedRoot, lock, 'soter/contracts/lock.schema.json', 'Configuration lock');
  if (expectedHost && lock.host.id !== expectedHost) {
    throw new Error(
      'Configuration lock host ' + lock.host.id
        + ' does not match the active host projection ' + expectedHost + '.'
    );
  }
  const current = lockMatchesResolution({
    lock,
    root: resolvedRoot,
    configPath: lock.configuration.path
  });
  if (!current.matches) {
    throw new Error(
      'Configuration lock is stale: expected ' + current.expectedFingerprint
        + ' but observed ' + current.observedFingerprint + '.'
    );
  }
  return { file, lock };
}

function assertExactRun(root, lockFile, lock, run, allowedStates = EXECUTABLE_RUN_STATES) {
  contractFailures(root, run, 'soter/contracts/run-envelope.schema.json', 'Run envelope');
  const expectedLockPath = repoRelativePath(root, lockFile);
  if (run.configurationLock.path !== expectedLockPath
    || run.configurationLock.fingerprint !== fingerprintLock(lock)
    || run.graphFingerprint !== lock.graphFingerprint
    || fingerprintJson(run.host) !== fingerprintJson(lock.host)
    || fingerprintJson(run.bindings) !== fingerprintJson(lock.bindings)
    || fingerprintJson(run.effectPolicies) !== fingerprintJson(lock.effectPolicies)) {
    throw new Error('Run envelope does not match the exact lock, graph, host, bindings, and effect policy.');
  }
  if (!allowedStates.has(run.lifecycleState)) {
    throw new Error(
      'Run envelope state ' + run.lifecycleState
        + ' cannot continue this host request.'
    );
  }
  return run;
}

function exactRun(root, lockFile, lock, runPath, allowedStates = EXECUTABLE_RUN_STATES) {
  const file = resolveRepoPath(root, runPath);
  const run = assertExactRun(root, lockFile, lock, readJson(file), allowedStates);
  return { file, run };
}

function atOrNow(at) {
  return at || new Date().toISOString();
}

function idPart(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function checkpointFingerprint(checkpoint) {
  const value = structuredClone(checkpoint);
  delete value.checkpointFingerprint;
  return fingerprintJson(value);
}

function sealCheckpoint(checkpoint) {
  return {
    ...checkpoint,
    checkpointFingerprint: checkpointFingerprint(checkpoint)
  };
}

function assertCheckpoint(root, checkpoint) {
  contractFailures(
    root,
    checkpoint,
    'soter/contracts/host-call-checkpoint.schema.json',
    'Host call checkpoint'
  );
  if (checkpoint.checkpointFingerprint !== checkpointFingerprint(checkpoint)) {
    throw new Error('Host call checkpoint fingerprint does not match its durable contents.');
  }
  if (checkpoint.state !== checkpoint.call.state
    || checkpoint.configurationLock.fingerprint
      !== checkpoint.call.configurationLockFingerprint
    || checkpoint.graphFingerprint !== checkpoint.call.graphFingerprint
    || fingerprintJson(checkpoint.host) !== fingerprintJson(checkpoint.call.host)) {
    throw new Error('Host call checkpoint metadata does not match its exact call record.');
  }
  if ((checkpoint.kind === 'capability') !== Boolean(checkpoint.run)
    || (checkpoint.kind === 'capability') !== Boolean(checkpoint.input)) {
    throw new Error('Host call checkpoint kind does not match its run and input state.');
  }
  const expectedCallContract = checkpoint.kind === 'capability'
    ? 'soter://contracts/host-tool-call/v1'
    : 'soter://contracts/provider-probe-call/v1';
  if (checkpoint.call.$contract !== expectedCallContract) {
    throw new Error('Host call checkpoint kind does not match its nested call contract.');
  }
  contractFailures(
    root,
    checkpoint.call,
    checkpoint.kind === 'capability'
      ? 'soter/contracts/host-tool-call.schema.json'
      : 'soter/contracts/provider-probe-call.schema.json',
    'Checkpoint call'
  );
  return checkpoint;
}

function durableRunIdentity(run) {
  return fingerprintJson({
    id: run.id,
    createdAt: run.createdAt,
    requestedOutcome: run.requestedOutcome,
    initiation: run.initiation,
    intent: run.intent,
    automation: run.automation,
    configurationLock: run.configurationLock,
    graphFingerprint: run.graphFingerprint,
    scenario: run.scenario || null,
    context: run.context,
    bindings: run.bindings,
    host: run.host,
    effectPolicies: run.effectPolicies
  });
}

function runCheckpointEntry(call) {
  return {
    id: 'host-call.' + call.id,
    kind: 'host-tool-call',
    callId: call.id,
    state: call.state,
    callFingerprint: fingerprintJson(call),
    updatedAt: call.completedAt || call.createdAt,
    details: call.state === 'requested'
      ? 'Core emitted one exact logical provider request; the native result is pending.'
      : 'Core closed the exact logical provider request in state ' + call.state + '.'
  };
}

function invocationFromCall(call) {
  if (call.state === 'requested') return null;
  return {
    id: 'effect.' + call.id.slice('toolcall.'.length),
    capability: call.capability.id,
    capabilityVersion: call.capability.version,
    providerPack: call.provider.pack,
    providerImplementation: call.provider.implementation,
    providerVersion: call.provider.version,
    containment: call.provider.containment,
    authority: call.authority,
    startedAt: call.createdAt,
    completedAt: call.completedAt,
    declaredEffects: call.declaredEffects,
    policyDecisions: call.policyDecisions,
    state: call.state === 'completed' ? 'passed' : call.state,
    inputFingerprint: call.inputFingerprint,
    outputFingerprint: call.outputFingerprint,
    error: call.error
  };
}

function syncRunWithCheckpoint(run, checkpoint) {
  if (checkpoint.kind !== 'capability') return run;
  const next = structuredClone(run);
  const entry = runCheckpointEntry(checkpoint.call);
  const checkpointIndex = next.checkpoints.findIndex((item) => item.id === entry.id);
  if (checkpointIndex >= 0) {
    const current = next.checkpoints[checkpointIndex];
    if (checkpoint.call.state === 'requested'
      && ['completed', 'failed', 'blocked'].includes(current.state)) {
      return next;
    }
    next.checkpoints[checkpointIndex] = entry;
  } else {
    next.checkpoints.push(entry);
  }
  if (checkpoint.call.state === 'requested') {
    next.lifecycleState = 'executing';
    return next;
  }
  const invocation = invocationFromCall(checkpoint.call);
  const effectIndex = next.effects.findIndex((item) => item.id === invocation.id);
  if (effectIndex >= 0) next.effects[effectIndex] = invocation;
  else next.effects.push(invocation);
  if (checkpoint.call.state === 'completed' && checkpoint.call.outputFingerprint) {
    const output = {
      id: 'output.' + checkpoint.call.id.slice('toolcall.'.length),
      callId: checkpoint.call.id,
      capability: checkpoint.call.capability.id,
      fingerprint: checkpoint.call.outputFingerprint
    };
    const outputIndex = next.outputs.findIndex((item) => item.id === output.id);
    if (outputIndex >= 0) next.outputs[outputIndex] = output;
    else next.outputs.push(output);
    next.lifecycleState = 'executing';
  } else {
    next.lifecycleState = 'paused';
  }
  return next;
}

export async function prepareProviderProbeExecution({
  root,
  lockPath,
  providerImplementation,
  callId,
  probeId,
  at,
  validForSeconds = 300,
  expectedHost
}) {
  const createdAt = atOrNow(at);
  const { lock } = exactLock(root, lockPath, expectedHost);
  const providerPart = idPart(
    providerImplementation.startsWith('provider.')
      ? providerImplementation.slice('provider.'.length)
      : providerImplementation
  );
  return prepareProviderProbeCall({
    root,
    lock,
    providerImplementation,
    callId: callId || 'probecall.' + idPart(lock.configuration.name) + '.' + idPart(createdAt),
    probeId: probeId || 'probe.' + providerPart + '.' + idPart(createdAt),
    at: createdAt,
    validForSeconds
  });
}

export async function completeProviderProbeExecution({
  root,
  lockPath,
  call,
  response,
  at,
  expectedHost
}) {
  const { lock } = exactLock(root, lockPath, expectedHost);
  return completeProviderProbeCall({
    root,
    lock,
    call,
    response,
    at: atOrNow(at)
  });
}

export async function prepareCapabilityExecution({
  root,
  lockPath,
  runPath,
  capability,
  authority,
  providerImplementation,
  input,
  callId,
  at,
  expectedHost
}) {
  const createdAt = atOrNow(at);
  const { file: lockFile, lock } = exactLock(root, lockPath, expectedHost);
  const { run } = exactRun(path.resolve(root), lockFile, lock, runPath);
  return prepareHostToolCall({
    root,
    lock,
    runId: run.id,
    callId: callId || 'toolcall.' + idPart(run.id.slice('run.'.length)) + '.' + idPart(createdAt),
    capability,
    authority,
    containment: 'connected',
    providerImplementation,
    input,
    at: createdAt,
    approvedEffects: []
  });
}

export async function completeCapabilityExecution({
  root,
  lockPath,
  runPath,
  call,
  input,
  response,
  at,
  expectedHost
}) {
  const { file: lockFile, lock } = exactLock(root, lockPath, expectedHost);
  const { run } = exactRun(path.resolve(root), lockFile, lock, runPath);
  if (call.runId !== run.id) {
    throw new Error('Host tool call does not belong to the supplied exact run envelope.');
  }
  return completeHostToolCall({
    root,
    lock,
    call,
    input,
    response,
    at: atOrNow(at)
  });
}

export function failHostExecution({
  root,
  lockPath,
  runPath,
  call,
  errorKind,
  message,
  at,
  expectedHost
}) {
  const { file: lockFile, lock } = exactLock(root, lockPath, expectedHost);
  const error = { kind: errorKind, message };
  if (call?.$contract === 'soter://contracts/provider-probe-call/v1') {
    if (runPath) {
      throw new Error('Provider probe failures do not accept a run envelope.');
    }
    return {
      call: failProviderProbeCall({ root, lock, call, error, at: atOrNow(at) })
    };
  }
  if (call?.$contract === 'soter://contracts/host-tool-call/v1') {
    if (!runPath) throw new Error('Capability call failures require runPath.');
    const { run } = exactRun(path.resolve(root), lockFile, lock, runPath);
    if (call.runId !== run.id) {
      throw new Error('Host tool call does not belong to the supplied exact run envelope.');
    }
    return {
      call: failHostToolCall({ root, lock, call, error, at: atOrNow(at) })
    };
  }
  throw new Error('Unsupported host call contract.');
}

function baseDurableCheckpoint({ root, lockFile, lock, kind, call, input, result, run, at }) {
  return {
    $contract: 'soter://contracts/host-call-checkpoint/v1',
    contractVersion: '1.0.0',
    id: 'checkpoint.' + call.id,
    kind,
    createdAt: call.createdAt,
    updatedAt: at,
    state: call.state,
    configurationLock: {
      path: repoRelativePath(root, lockFile),
      fingerprint: fingerprintLock(lock)
    },
    graphFingerprint: lock.graphFingerprint,
    host: structuredClone(call.host),
    run,
    call: structuredClone(call),
    input: input ? structuredClone(input) : null,
    result: result ? structuredClone(result) : null,
    privacy: {
      scope: 'private',
      rawProviderResponsePersisted: false,
      hostCredentialValuesPersisted: false
    },
    checkpointFingerprint: fingerprintJson(null)
  };
}

function persistDurableCheckpoint(root, checkpoint, run = null) {
  let next = structuredClone(checkpoint);
  let nextRun = run ? syncRunWithCheckpoint(run, next) : null;
  if (nextRun) {
    next.run.fingerprint = fingerprintJson(nextRun);
  }
  next = sealCheckpoint(next);
  const checkpointState = writeHostCallCheckpoint(root, next);
  const runState = nextRun ? writeRunState(root, nextRun) : null;
  return {
    checkpoint: next,
    checkpointPath: checkpointState.path,
    run: nextRun,
    runPath: runState?.path || null
  };
}

function stageDurableRun(root, lockFile, lock, runPath) {
  const source = exactRun(root, lockFile, lock, runPath);
  const sourcePath = repoRelativePath(root, source.file);
  if (!hasRunState(root, source.run.id)) {
    const state = writeRunState(root, structuredClone(source.run));
    return {
      run: structuredClone(source.run),
      sourcePath,
      statePath: state.path
    };
  }
  const state = readRunState(root, source.run.id);
  const run = assertExactRun(root, lockFile, lock, state.run);
  if (durableRunIdentity(run) !== durableRunIdentity(source.run)) {
    throw new Error('Durable run state does not match the supplied run envelope identity.');
  }
  return {
    run,
    sourcePath,
    statePath: repoRelativePath(root, state.file)
  };
}

function loadedCheckpoint(root, checkpointId, expectedHost) {
  const state = readHostCallCheckpoint(root, checkpointId);
  const checkpoint = assertCheckpoint(path.resolve(root), state.checkpoint);
  if (expectedHost && checkpoint.host.id !== expectedHost) {
    throw new Error(
      'Host call checkpoint belongs to ' + checkpoint.host.id
        + ', not the active ' + expectedHost + ' host projection.'
    );
  }
  return { checkpointFile: state.file, checkpoint };
}

function exactCheckpoint(root, checkpointId, expectedHost) {
  const state = loadedCheckpoint(root, checkpointId, expectedHost);
  const lockState = exactLock(root, state.checkpoint.configurationLock.path, expectedHost);
  if (state.checkpoint.configurationLock.fingerprint !== fingerprintLock(lockState.lock)
    || state.checkpoint.graphFingerprint !== lockState.lock.graphFingerprint) {
    throw new Error('Host call checkpoint does not match the current exact lock and graph.');
  }
  return {
    checkpointFile: state.checkpointFile,
    checkpoint: state.checkpoint,
    lockFile: lockState.file,
    lock: lockState.lock
  };
}

function durableRunForCheckpoint(root, lockFile, lock, checkpoint) {
  if (!checkpoint.run) return null;
  const state = readRunState(root, checkpoint.run.id);
  if (repoRelativePath(root, state.file) !== checkpoint.run.statePath) {
    throw new Error('Host call checkpoint points to an unexpected durable run path.');
  }
  const allowedStates = checkpoint.state === 'requested'
    ? EXECUTABLE_RUN_STATES
    : DURABLE_RUN_STATES;
  let run = assertExactRun(root, lockFile, lock, state.run, allowedStates);
  const expectedEntry = runCheckpointEntry(checkpoint.call);
  const currentEntry = run.checkpoints.find((item) => item.id === expectedEntry.id);
  if (currentEntry && currentEntry.callFingerprint !== expectedEntry.callFingerprint) {
    const checkpointProgressed = currentEntry.state === 'requested'
      && ['completed', 'failed', 'blocked'].includes(checkpoint.call.state);
    const runProgressed = checkpoint.call.state === 'requested'
      && ['completed', 'failed', 'blocked'].includes(currentEntry.state);
    if (checkpointProgressed) {
      run = syncRunWithCheckpoint(run, checkpoint);
      writeRunState(root, run);
    } else if (!runProgressed) {
      throw new Error('Durable run checkpoint conflicts with the exact host call checkpoint.');
    }
  } else if (!currentEntry) {
    run = syncRunWithCheckpoint(run, checkpoint);
    writeRunState(root, run);
  }
  return run;
}

function pendingCheckpointForRun(root, runId, expectedHost) {
  return listHostCallCheckpointDocuments(root)
    .map((item) => assertCheckpoint(path.resolve(root), item.checkpoint))
    .find((checkpoint) => {
      return (!expectedHost || checkpoint.host.id === expectedHost)
        && checkpoint.kind === 'capability'
        && checkpoint.run?.id === runId
        && checkpoint.state === 'requested';
    }) || null;
}

export async function prepareDurableProviderProbeExecution(options) {
  const prepared = await prepareProviderProbeExecution(options);
  const { file: lockFile, lock } = exactLock(
    options.root,
    options.lockPath,
    options.expectedHost
  );
  const at = options.at || prepared.call.createdAt;
  const checkpoint = baseDurableCheckpoint({
    root: options.root,
    lockFile,
    lock,
    kind: 'provider-probe',
    call: prepared.call,
    input: null,
    result: null,
    run: null,
    at
  });
  if (hasHostCallCheckpoint(options.root, checkpoint.id)) {
    throw new Error('Durable host call checkpoint already exists: ' + checkpoint.id + '.');
  }
  return persistDurableCheckpoint(options.root, checkpoint);
}

export async function prepareDurableCapabilityExecution(options) {
  const { file: lockFile, lock } = exactLock(
    options.root,
    options.lockPath,
    options.expectedHost
  );
  if (containsCredentialMaterial(options.input)) {
    throw new Error('Capability input contains credential-like material and cannot enter durable state.');
  }
  const durable = stageDurableRun(path.resolve(options.root), lockFile, lock, options.runPath);
  const pending = pendingCheckpointForRun(options.root, durable.run.id, options.expectedHost);
  if (pending) {
    throw new Error(
      'Run ' + durable.run.id + ' already has pending host call checkpoint ' + pending.id + '.'
    );
  }
  const createdAt = atOrNow(options.at);
  const prepared = await prepareHostToolCall({
    root: options.root,
    lock,
    runId: durable.run.id,
    callId: options.callId || 'toolcall.'
      + idPart(durable.run.id.slice('run.'.length)) + '.' + idPart(createdAt),
    capability: options.capability,
    authority: options.authority,
    containment: 'connected',
    providerImplementation: options.providerImplementation,
    input: options.input,
    at: createdAt,
    approvedEffects: []
  });
  const checkpoint = baseDurableCheckpoint({
    root: options.root,
    lockFile,
    lock,
    kind: 'capability',
    call: prepared.call,
    input: options.input,
    result: null,
    run: {
      id: durable.run.id,
      sourcePath: durable.sourcePath,
      statePath: durable.statePath,
      fingerprint: fingerprintJson(durable.run)
    },
    at: createdAt
  });
  if (hasHostCallCheckpoint(options.root, checkpoint.id)) {
    throw new Error('Durable host call checkpoint already exists: ' + checkpoint.id + '.');
  }
  return persistDurableCheckpoint(options.root, checkpoint, durable.run);
}

function durableResult(root, state) {
  const run = state.checkpoint.kind === 'capability'
    ? durableRunForCheckpoint(root, state.lockFile, state.lock, state.checkpoint)
    : null;
  return {
    checkpoint: state.checkpoint,
    checkpointPath: repoRelativePath(root, state.checkpointFile),
    run,
    runPath: run ? repoRelativePath(root, readRunState(root, run.id).file) : null
  };
}

export async function completeDurableProviderProbeExecution({
  root,
  checkpointId,
  response,
  at,
  expectedHost
}) {
  const state = exactCheckpoint(root, checkpointId, expectedHost);
  const checkpoint = state.checkpoint;
  if (checkpoint.kind !== 'provider-probe') {
    throw new Error('Checkpoint ' + checkpointId + ' is not a provider probe call.');
  }
  const responseFingerprint = fingerprintJson(response);
  if (checkpoint.state !== 'requested') {
    if (checkpoint.call.responseFingerprint === responseFingerprint) {
      return durableResult(root, state);
    }
    throw new Error('Only a requested provider probe checkpoint can accept a response.');
  }
  const completedAt = atOrNow(at);
  const completed = await completeProviderProbeCall({
    root,
    lock: state.lock,
    call: checkpoint.call,
    response,
    at: completedAt
  });
  const next = {
    ...checkpoint,
    updatedAt: completedAt,
    state: completed.call.state,
    call: completed.call,
    result: completed.call.state === 'completed' ? completed.probe : null
  };
  return persistDurableCheckpoint(root, next);
}

export async function completeDurableCapabilityExecution({
  root,
  checkpointId,
  response,
  at,
  expectedHost
}) {
  const state = exactCheckpoint(root, checkpointId, expectedHost);
  const checkpoint = state.checkpoint;
  if (checkpoint.kind !== 'capability') {
    throw new Error('Checkpoint ' + checkpointId + ' is not a capability call.');
  }
  const responseFingerprint = fingerprintJson(response);
  if (checkpoint.state !== 'requested') {
    if (checkpoint.call.responseFingerprint === responseFingerprint) {
      return durableResult(root, state);
    }
    throw new Error('Only a requested capability checkpoint can accept a response.');
  }
  const run = durableRunForCheckpoint(root, state.lockFile, state.lock, checkpoint);
  const completedAt = atOrNow(at);
  const completed = await completeHostToolCall({
    root,
    lock: state.lock,
    call: checkpoint.call,
    input: checkpoint.input,
    response,
    at: completedAt
  });
  const next = {
    ...checkpoint,
    updatedAt: completedAt,
    state: completed.call.state,
    call: completed.call,
    result: completed.call.state === 'completed' ? completed.output : null
  };
  return persistDurableCheckpoint(root, next, run);
}

export function failDurableHostExecution({
  root,
  checkpointId,
  errorKind,
  message,
  at,
  expectedHost
}) {
  const state = exactCheckpoint(root, checkpointId, expectedHost);
  const checkpoint = state.checkpoint;
  if (checkpoint.state !== 'requested') {
    if (checkpoint.call.error?.kind === errorKind && checkpoint.call.error?.message === message) {
      return durableResult(root, state);
    }
    throw new Error('Only a requested host call checkpoint can record a host failure.');
  }
  const completedAt = atOrNow(at);
  const failedCall = checkpoint.kind === 'capability'
    ? failHostToolCall({
      root,
      lock: state.lock,
      call: checkpoint.call,
      error: { kind: errorKind, message },
      at: completedAt
    })
    : failProviderProbeCall({
      root,
      lock: state.lock,
      call: checkpoint.call,
      error: { kind: errorKind, message },
      at: completedAt
    });
  const next = {
    ...checkpoint,
    updatedAt: completedAt,
    state: failedCall.state,
    call: failedCall,
    result: null
  };
  const run = checkpoint.kind === 'capability'
    ? durableRunForCheckpoint(root, state.lockFile, state.lock, checkpoint)
    : null;
  return persistDurableCheckpoint(root, next, run);
}

export function getDurableHostExecution({ root, checkpointId, expectedHost }) {
  const state = loadedCheckpoint(root, checkpointId, expectedHost);
  return {
    checkpoint: state.checkpoint,
    checkpointPath: repoRelativePath(root, state.checkpointFile)
  };
}

export function getDurableProviderProbe({ root, checkpointId, expectedHost }) {
  const state = exactCheckpoint(root, checkpointId, expectedHost);
  if (state.checkpoint.kind !== 'provider-probe'
    || state.checkpoint.state !== 'completed'
    || !state.checkpoint.result) {
    throw new Error('Checkpoint ' + checkpointId + ' is not a completed provider probe.');
  }
  return structuredClone(state.checkpoint.result);
}

export function listDurableHostExecutions({ root, state, expectedHost }) {
  const checkpoints = listHostCallCheckpointDocuments(root)
    .map((item) => assertCheckpoint(path.resolve(root), item.checkpoint))
    .filter((checkpoint) => !expectedHost || checkpoint.host.id === expectedHost)
    .filter((checkpoint) => !state || checkpoint.state === state)
    .map((checkpoint) => ({
      id: checkpoint.id,
      kind: checkpoint.kind,
      state: checkpoint.state,
      callId: checkpoint.call.id,
      updatedAt: checkpoint.updatedAt,
      host: checkpoint.host.id,
      provider: checkpoint.call.provider.implementation,
      capability: checkpoint.kind === 'capability' ? checkpoint.call.capability.id : null,
      runId: checkpoint.run?.id || null
    }));
  return { checkpoints };
}
