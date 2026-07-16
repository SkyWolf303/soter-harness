#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatDoctorReport, runConnectedDoctor, runOfflineDoctor } from './doctor.mjs';
import { assembleMeetingIntakeContext } from './context.mjs';
import {
  createContextAssemblyEvidence,
  createContainedTransactionEvidence,
  createResolutionEvidence,
  createRunPreparationEvidence
} from './evidence.mjs';
import { checkMeetingIntakeFixtures, writeMeetingIntakeFixtures } from './fixtures.mjs';
import { readJson, resolveRepoPath, writeJson } from './lib/canonical-json.mjs';
import { fingerprintLock, resolveConfiguration } from './resolve.mjs';
import { prepareRunEnvelope } from './run.mjs';
import { runContainedMeetingIntakeTransaction } from './transaction.mjs';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function option(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) {
    throw new Error(name + ' requires a value.');
  }
  return args[index + 1];
}

function options(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue;
    if (!args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error(name + ' requires a value.');
    }
    values.push(args[index + 1]);
  }
  return values;
}

function requiredOption(args, name) {
  const value = option(args, name);
  if (!value) throw new Error('Missing required option ' + name + '.');
  return value;
}

function nowIdPart(createdAt) {
  return createdAt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function print(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function writeEvidence(root, directory, records) {
  if (!directory) return;
  const targetDirectory = resolveRepoPath(root, directory);
  for (const record of records) {
    writeJson(path.join(targetDirectory, record.id + '.json'), record);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const root = path.resolve(option(args, '--root', defaultRoot));
  const json = args.includes('--json');
  const createdAt = option(args, '--at', new Date().toISOString());
  const idPart = nowIdPart(createdAt);

  if (command === 'resolve') {
    const configPath = option(args, '--config');
    const lock = resolveConfiguration({ root, configPath });
    const output = option(args, '--output');
    if (output) writeJson(resolveRepoPath(root, output), lock);
    if (json) {
      print(lock);
    } else {
      process.stdout.write(
        'Resolved ' + lock.configuration.name + ' to ' + lock.packs.length + ' packs.\n'
          + 'Lock: ' + fingerprintLock(lock) + '\n'
          + (output ? 'Wrote: ' + output + '\n' : '')
      );
    }
    return;
  }

  if (command === 'prepare') {
    const lockPath = requiredOption(args, '--lock');
    const lock = readJson(resolveRepoPath(root, lockPath));
    const scenarioPath = option(args, '--scenario');
    const runId = option(args, '--run-id', 'run.' + lock.configuration.name + '.' + idPart);
    const resolutionEvidenceId = option(
      args,
      '--resolution-evidence-id',
      'evidence.' + lock.configuration.name + '.resolution.' + idPart
    );
    const preparationEvidenceId = option(
      args,
      '--preparation-evidence-id',
      'evidence.' + lock.configuration.name + '.preparation.' + idPart
    );
    const envelope = prepareRunEnvelope({
      root,
      lock,
      lockPath,
      scenarioPath,
      automationId: option(args, '--automation'),
      runId,
      createdAt,
      requestedOutcome: option(args, '--outcome'),
      evidenceIds: [resolutionEvidenceId, preparationEvidenceId]
    });
    const evidence = [
      createResolutionEvidence({ lock, id: resolutionEvidenceId, createdAt }),
      createRunPreparationEvidence({
        lock,
        envelope,
        id: preparationEvidenceId,
        createdAt
      })
    ];
    const output = option(args, '--output');
    if (output) writeJson(resolveRepoPath(root, output), envelope);
    writeEvidence(root, option(args, '--evidence-dir'), evidence);
    if (json) {
      print({ envelope, evidence });
    } else {
      process.stdout.write(
        'Prepared ' + envelope.id + ' at lifecycle state ' + envelope.lifecycleState + '.\n'
          + 'External effects executed: 0\n'
          + (output ? 'Wrote: ' + output + '\n' : '')
      );
    }
    return;
  }

  if (command === 'doctor') {
    const lockPath = requiredOption(args, '--lock');
    const lock = readJson(resolveRepoPath(root, lockPath));
    const level = option(args, '--level', 'offline');
    if (!['offline', 'connected'].includes(level)) {
      throw new Error('doctor --level must be offline or connected; canary execution is not implemented.');
    }
    const evidenceId = option(
      args,
      '--evidence-id',
      'evidence.' + lock.configuration.name + '.doctor.' + idPart
    );
    const doctorOptions = {
      root,
      configPath: option(args, '--config'),
      lock,
      doctorId: option(args, '--doctor-id', 'doctor.' + lock.configuration.name + '.' + idPart),
      evidenceId,
      createdAt
    };
    const result = level === 'connected'
      ? runConnectedDoctor({
        ...doctorOptions,
        providerProbes: options(args, '--probe').map((probePath) => {
          return readJson(resolveRepoPath(root, probePath));
        })
      })
      : runOfflineDoctor(doctorOptions);
    const output = option(args, '--output');
    if (output) writeJson(resolveRepoPath(root, output), result.report);
    writeEvidence(root, option(args, '--evidence-dir'), result.evidence);
    if (json) {
      print(result.report);
    } else {
      process.stdout.write(formatDoctorReport(result.report) + '\n');
      if (output) process.stdout.write('Wrote: ' + output + '\n');
    }
    if (result.report.states.valid === 'failed' || result.report.states.valid === 'stale') {
      process.exitCode = 1;
    }
    if (level === 'connected' && result.report.states.ready !== 'passed') {
      process.exitCode = 1;
    }
    return;
  }

  if (command === 'context') {
    const lockPath = requiredOption(args, '--lock');
    const lock = readJson(resolveRepoPath(root, lockPath));
    const runId = option(args, '--run-id', 'run.' + lock.configuration.name + '.context.' + idPart);
    const snapshotId = option(
      args,
      '--snapshot-id',
      'context.' + lock.configuration.name + '.' + idPart
    );
    const resolutionEvidenceId = option(
      args,
      '--resolution-evidence-id',
      'evidence.' + lock.configuration.name + '.resolution.' + idPart
    );
    const contextEvidenceId = option(
      args,
      '--context-evidence-id',
      'evidence.' + lock.configuration.name + '.context.' + idPart
    );
    const contained = await assembleMeetingIntakeContext({
      root,
      lock,
      lockPath,
      scenarioPath: option(args, '--scenario'),
      runId,
      snapshotId,
      createdAt,
      meetingId: requiredOption(args, '--meeting-id'),
      recordingUri: requiredOption(args, '--recording-uri'),
      evidenceIds: [resolutionEvidenceId, contextEvidenceId]
    });
    const evidence = [
      createResolutionEvidence({ lock, id: resolutionEvidenceId, createdAt }),
      createContextAssemblyEvidence({
        lock,
        envelope: contained.envelope,
        snapshot: contained.snapshot,
        id: contextEvidenceId,
        createdAt
      })
    ];
    const output = option(args, '--output');
    const snapshotOutput = option(args, '--snapshot-output');
    if (output) writeJson(resolveRepoPath(root, output), contained.envelope);
    if (snapshotOutput) writeJson(resolveRepoPath(root, snapshotOutput), contained.snapshot);
    writeEvidence(root, option(args, '--evidence-dir'), evidence);
    if (json) {
      print({ ...contained, evidence });
    } else {
      process.stdout.write(
        'Assembled ' + contained.snapshot.entries.length + ' context entries through '
          + contained.envelope.effects.length + ' typed fixture reads.\n'
          + 'Run state: ' + contained.envelope.lifecycleState + '; external writes executed: 0\n'
      );
    }
    return;
  }

  if (command === 'transaction') {
    const lockPath = requiredOption(args, '--lock');
    const lock = readJson(resolveRepoPath(root, lockPath));
    const approved = args.includes('--approve');
    const runId = option(args, '--run-id', 'run.' + lock.configuration.name + '.transaction.' + idPart);
    const transactionEvidenceId = 'evidence.' + lock.configuration.name + '.transaction.' + idPart;
    const resolutionEvidenceId = 'evidence.' + lock.configuration.name + '.resolution.' + idPart;
    const transaction = await runContainedMeetingIntakeTransaction({
      root,
      lock,
      lockPath,
      scenarioPath: option(args, '--scenario'),
      runId,
      snapshotId: option(args, '--snapshot-id', 'context.' + lock.configuration.name + '.transaction.' + idPart),
      changeSetId: option(args, '--change-set-id', 'changeset.' + lock.configuration.name + '.' + idPart),
      approvalId: option(args, '--approval-id', 'approval.' + lock.configuration.name + '.' + idPart),
      createdAt,
      actor: option(args, '--actor', 'user'),
      approved,
      evidenceIds: approved ? [resolutionEvidenceId, transactionEvidenceId] : []
    });
    const evidence = approved ? [
      createResolutionEvidence({ lock, id: resolutionEvidenceId, createdAt }),
      createContainedTransactionEvidence({
        lock,
        envelope: transaction.envelope,
        changeSet: transaction.changeSet,
        approval: transaction.approval,
        id: transactionEvidenceId,
        createdAt
      })
    ] : [];
    const output = option(args, '--output');
    const snapshotOutput = option(args, '--snapshot-output');
    const changeSetOutput = option(args, '--change-set-output');
    const approvalOutput = option(args, '--approval-output');
    if (output) writeJson(resolveRepoPath(root, output), transaction.envelope);
    if (snapshotOutput) writeJson(resolveRepoPath(root, snapshotOutput), transaction.snapshot);
    if (changeSetOutput) writeJson(resolveRepoPath(root, changeSetOutput), transaction.changeSet);
    if (approvalOutput && transaction.approval) {
      writeJson(resolveRepoPath(root, approvalOutput), transaction.approval);
    }
    writeEvidence(root, option(args, '--evidence-dir'), evidence);
    if (json) {
      print({ ...transaction, evidence });
    } else if (!approved) {
      process.stdout.write(
        'Previewed ' + transaction.changeSet.operations.length + ' write operations.\n'
          + 'State: proposed; writes executed: 0. Re-run with --approve to authorize this generated scope.\n'
      );
    } else {
      process.stdout.write(
        'Transaction ' + transaction.changeSet.state + ' with '
          + transaction.changeSet.operations.length + ' approved writes.\n'
          + 'Read-after-write verification: ' + transaction.changeSet.verification.state + '\n'
      );
    }
    return;
  }

  if (command === 'selftest') {
    const { selftest } = await import('./selftest.mjs');
    process.exitCode = await selftest(root) ? 0 : 1;
    return;
  }

  if (command === 'fixtures') {
    if (args.includes('--update')) {
      const fixtures = await writeMeetingIntakeFixtures(root);
      process.stdout.write('Updated ' + fixtures.size + ' meeting-intake Core fixtures.\n');
      return;
    }
    if (args.includes('--check')) {
      const result = await checkMeetingIntakeFixtures(root);
      if (json) {
        print({ matches: result.matches, mismatches: result.mismatches });
      } else if (result.matches) {
        process.stdout.write('Core fixtures: current.\n');
      } else {
        for (const mismatch of result.mismatches) {
          process.stderr.write('STALE ' + mismatch.path + ': ' + mismatch.reason + '\n');
        }
      }
      process.exitCode = result.matches ? 0 : 1;
      return;
    }
    throw new Error('fixtures requires --check or --update.');
  }

  throw new Error(
    'Usage: node soter/core/cli.mjs <resolve|prepare|context|transaction|doctor|fixtures|selftest> [options]\n'
      + '  resolve [--config PATH] [--output PATH] [--json]\n'
      + '  prepare --lock PATH [--scenario PATH] [--output PATH] [--evidence-dir PATH] [--json]\n'
      + '  context --lock PATH --meeting-id ID --recording-uri URI [--scenario PATH] [--json]\n'
      + '  transaction --lock PATH [--scenario PATH] [--approve] [--json]\n'
      + '  doctor --lock PATH [--level offline|connected] [--probe PATH ...] [--config PATH] [--json]\n'
      + '  fixtures <--check|--update> [--json]'
  );
}

main().catch((error) => {
  process.stderr.write('Soter Core: ' + error.message + '\n');
  process.exitCode = 1;
});
