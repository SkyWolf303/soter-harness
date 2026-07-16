import fs from 'node:fs';
import path from 'node:path';

import { readJson, repoRelativePath, resolveRepoPath } from './lib/canonical-json.mjs';

const STATE_ROOT = '.soter/state';
const SAFE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

function safeId(value, label) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new Error(label + ' is not a safe runtime-state identifier.');
  }
  return value;
}

function stateFile(root, directory, id) {
  return resolveRepoPath(root, path.join(STATE_ROOT, directory, safeId(id, directory + ' id') + '.json'));
}

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(directory, 0o700);
  } catch {
    // Some filesystems do not expose POSIX permissions; atomic placement still applies.
  }
}

function atomicWriteJson(file, value) {
  ensurePrivateDirectory(path.dirname(file));
  const temporary = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  let descriptor = null;
  try {
    descriptor = fs.openSync(temporary, 'w', 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(value, null, 2) + '\n');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, file);
    try {
      fs.chmodSync(file, 0o600);
      const directory = fs.openSync(path.dirname(file), 'r');
      try {
        fs.fsyncSync(directory);
      } finally {
        fs.closeSync(directory);
      }
    } catch {
      // Some filesystems do not support POSIX modes or directory fsync.
    }
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

export function runtimeStateRoot(root) {
  return resolveRepoPath(root, STATE_ROOT);
}

export function runStatePath(root, runId) {
  return stateFile(root, 'runs', safeId(runId, 'run id'));
}

export function hostCallCheckpointPath(root, checkpointId) {
  return stateFile(root, 'host-calls', safeId(checkpointId, 'checkpoint id'));
}

export function hasHostCallCheckpoint(root, checkpointId) {
  return fs.existsSync(hostCallCheckpointPath(root, checkpointId));
}

export function hasRunState(root, runId) {
  return fs.existsSync(runStatePath(root, runId));
}

export function readRunState(root, runId) {
  const file = runStatePath(root, runId);
  if (!fs.existsSync(file)) throw new Error('Durable run state does not exist: ' + runId + '.');
  return { file, run: readJson(file) };
}

export function writeRunState(root, run) {
  const file = runStatePath(root, run.id);
  atomicWriteJson(file, run);
  return { file, path: repoRelativePath(root, file) };
}

export function readHostCallCheckpoint(root, checkpointId) {
  const file = hostCallCheckpointPath(root, checkpointId);
  if (!fs.existsSync(file)) {
    throw new Error('Durable host call checkpoint does not exist: ' + checkpointId + '.');
  }
  return { file, checkpoint: readJson(file) };
}

export function writeHostCallCheckpoint(root, checkpoint) {
  const file = hostCallCheckpointPath(root, checkpoint.id);
  atomicWriteJson(file, checkpoint);
  return { file, path: repoRelativePath(root, file) };
}

export function listHostCallCheckpointDocuments(root) {
  const directory = resolveRepoPath(root, path.join(STATE_ROOT, 'host-calls'));
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => {
      const file = path.join(directory, entry.name);
      return { file, checkpoint: readJson(file) };
    })
    .sort((left, right) => left.checkpoint.id.localeCompare(right.checkpoint.id, 'en'));
}
