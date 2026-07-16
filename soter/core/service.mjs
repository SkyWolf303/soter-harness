import path from 'node:path';

import { validateJsonSchema } from '../kernel/verify.mjs';
import {
  completeHostToolCall,
  failHostToolCall,
  prepareHostToolCall
} from './host-tools.mjs';
import { fingerprintJson, readJson, repoRelativePath, resolveRepoPath } from './lib/canonical-json.mjs';
import {
  completeProviderProbeCall,
  failProviderProbeCall,
  prepareProviderProbeCall
} from './provider-probes.mjs';
import { fingerprintLock, lockMatchesResolution } from './resolve.mjs';

const EXECUTABLE_RUN_STATES = new Set(['effects-established', 'executing']);

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

function exactRun(root, lockFile, lock, runPath) {
  const file = resolveRepoPath(root, runPath);
  const run = readJson(file);
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
  if (!EXECUTABLE_RUN_STATES.has(run.lifecycleState)) {
    throw new Error(
      'Run envelope state ' + run.lifecycleState
        + ' cannot emit a host request; expected effects-established or executing.'
    );
  }
  return run;
}

function atOrNow(at) {
  return at || new Date().toISOString();
}

function idPart(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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
  const run = exactRun(path.resolve(root), lockFile, lock, runPath);
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
  const run = exactRun(path.resolve(root), lockFile, lock, runPath);
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
    const run = exactRun(path.resolve(root), lockFile, lock, runPath);
    if (call.runId !== run.id) {
      throw new Error('Host tool call does not belong to the supplied exact run envelope.');
    }
    return {
      call: failHostToolCall({ root, lock, call, error, at: atOrNow(at) })
    };
  }
  throw new Error('Unsupported host call contract.');
}
