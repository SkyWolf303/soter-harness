#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatDoctorReport, runConnectedDoctor, runOfflineDoctor } from './doctor.mjs';
import { assembleMeetingIntakeContext } from './context.mjs';
import {
  finalizeMeetingIntakeConnectedContext,
  prepareMeetingIntakeConnectedContext
} from '../automations/meeting-intake/context.mjs';
import {
  createContextAssemblyEvidence,
  createContainedTransactionEvidence,
  createResolutionEvidence,
  createRunPreparationEvidence
} from './evidence.mjs';
import { checkMeetingIntakeFixtures, writeMeetingIntakeFixtures } from './fixtures.mjs';
import {
  readJson,
  readPrivateJsonInput,
  resolveRepoPath,
  writeJson
} from './lib/canonical-json.mjs';
import { fingerprintLock, resolveConfiguration } from './resolve.mjs';
import { prepareRunEnvelope } from './run.mjs';
import {
  completeDurableCapabilityExecution,
  completeDurableOperationPlanExecution,
  completeDurableProviderProbeExecution,
  failDurableHostExecution,
  getDurableHostExecution,
  getDurableProviderProbe,
  listDurableHostExecutions,
  prepareDurableCapabilityExecution,
  prepareDurableOperationPlanExecution,
  prepareDurableProviderProbeExecution
} from './service.mjs';
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
        providerProbes: [
          ...options(args, '--probe').map((probePath) => {
            return readJson(resolveRepoPath(root, probePath));
          }),
          ...options(args, '--probe-checkpoint').map((checkpointId) => {
            return getDurableProviderProbe({ root, checkpointId });
          })
        ]
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

  if (command === 'probe-prepare') {
    const lockPath = requiredOption(args, '--lock');
    const providerImplementation = requiredOption(args, '--provider');
    const prepared = await prepareDurableProviderProbeExecution({
      root,
      lockPath,
      providerImplementation,
      callId: option(args, '--call-id'),
      probeId: option(args, '--probe-id'),
      at: createdAt,
      validForSeconds: Number(option(args, '--valid-for-seconds', '300'))
    });
    const output = option(args, '--output');
    if (output) writeJson(resolveRepoPath(root, output), prepared.checkpoint);
    if (json) {
      print(prepared);
    } else {
      process.stdout.write(
        'Prepared ' + prepared.checkpoint.id + ' in state ' + prepared.checkpoint.state + '.\n'
          + 'Provider operation: ' + prepared.checkpoint.call.transport.server + '/'
          + (prepared.checkpoint.call.transport.operation || 'none') + '\n'
          + 'Native host tool: ' + (prepared.checkpoint.call.transport.tool || 'none') + '\n'
          + 'Durable checkpoint: ' + prepared.checkpointPath + '\n'
          + 'Raw provider response persistence: disabled by Core\n'
          + (output ? 'Wrote: ' + output + '\n' : '')
      );
    }
    if (prepared.checkpoint.state !== 'requested') process.exitCode = 1;
    return;
  }

  if (command === 'probe-complete') {
    const response = readPrivateJsonInput(root, requiredOption(args, '--response'));
    const completed = await completeDurableProviderProbeExecution({
      root,
      checkpointId: requiredOption(args, '--checkpoint'),
      response,
      at: createdAt
    });
    const checkpointOutput = option(args, '--checkpoint-output');
    const probeOutput = option(args, '--probe-output');
    if (checkpointOutput) {
      writeJson(resolveRepoPath(root, checkpointOutput), completed.checkpoint);
    }
    if (probeOutput && completed.checkpoint.result) {
      writeJson(resolveRepoPath(root, probeOutput), completed.checkpoint.result);
    }
    if (json) {
      print(completed);
    } else {
      process.stdout.write(
        'Completed ' + completed.checkpoint.id + ' in state '
          + completed.checkpoint.state + '.\n'
          + 'Raw provider response persisted by Core: no\n'
          + (completed.checkpoint.result
            ? 'Probe: ' + completed.checkpoint.result.id + '; capability compatibility remains '
              + completed.checkpoint.result.capabilities.map((item) => item.state).join(', ') + '.\n'
            : '')
          + (checkpointOutput ? 'Wrote checkpoint: ' + checkpointOutput + '\n' : '')
          + (probeOutput && completed.checkpoint.result ? 'Wrote probe: ' + probeOutput + '\n' : '')
      );
    }
    if (completed.checkpoint.state !== 'completed') process.exitCode = 1;
    return;
  }

  if (command === 'capability-prepare') {
    const prepared = await prepareDurableCapabilityExecution({
      root,
      lockPath: requiredOption(args, '--lock'),
      runPath: requiredOption(args, '--run'),
      capability: requiredOption(args, '--capability'),
      authority: requiredOption(args, '--authority'),
      providerImplementation: requiredOption(args, '--provider'),
      input: readJson(resolveRepoPath(root, requiredOption(args, '--input'))),
      callId: option(args, '--call-id'),
      at: createdAt
    });
    const output = option(args, '--output');
    if (output) writeJson(resolveRepoPath(root, output), prepared.checkpoint);
    if (json) {
      print(prepared);
    } else {
      process.stdout.write(
        'Prepared ' + prepared.checkpoint.id + ' in state ' + prepared.checkpoint.state + '.\n'
          + (prepared.checkpoint.state === 'requested'
            ? 'Provider operation: ' + prepared.checkpoint.call.transport.server + '/'
              + prepared.checkpoint.call.transport.operation + '\n'
              + 'Native host tool: ' + prepared.checkpoint.call.transport.tool + '\n'
            : 'Host request emitted: no\n')
          + 'Durable checkpoint: ' + prepared.checkpointPath + '\n'
          + 'Durable run: ' + prepared.runPath + '\n'
          + 'Connected write approval accepted by this command: no\n'
          + (output ? 'Wrote: ' + output + '\n' : '')
      );
    }
    if (prepared.checkpoint.state !== 'requested') process.exitCode = 1;
    return;
  }

  if (command === 'capability-complete') {
    const completed = await completeDurableCapabilityExecution({
      root,
      checkpointId: requiredOption(args, '--checkpoint'),
      response: readPrivateJsonInput(root, requiredOption(args, '--response')),
      at: createdAt
    });
    const checkpointOutput = option(args, '--checkpoint-output');
    const output = option(args, '--output');
    if (checkpointOutput) {
      writeJson(resolveRepoPath(root, checkpointOutput), completed.checkpoint);
    }
    if (output && completed.checkpoint.result) {
      writeJson(resolveRepoPath(root, output), completed.checkpoint.result);
    }
    if (json) {
      print(completed);
    } else {
      process.stdout.write(
        'Completed ' + completed.checkpoint.id + ' in state '
          + completed.checkpoint.state + '.\n'
          + 'Raw provider response persisted by Core: no\n'
          + (checkpointOutput ? 'Wrote checkpoint: ' + checkpointOutput + '\n' : '')
          + (output && completed.checkpoint.result ? 'Wrote output: ' + output + '\n' : '')
      );
    }
    if (completed.checkpoint.state !== 'completed') process.exitCode = 1;
    return;
  }

  if (command === 'plan-prepare') {
    if (option(args, '--output')) {
      throw new Error(
        'Operation plan checkpoints are private runtime state and cannot be exported into the repository.'
      );
    }
    const prepared = await prepareDurableOperationPlanExecution({
      root,
      lockPath: requiredOption(args, '--lock'),
      runPath: requiredOption(args, '--run'),
      plan: readPrivateJsonInput(root, requiredOption(args, '--plan')),
      at: createdAt
    });
    if (json) {
      print(prepared);
    } else {
      const call = prepared.currentCall;
      process.stdout.write(
        'Prepared operation plan ' + prepared.checkpoint.plan.id + ' in state '
          + prepared.checkpoint.state + '.\n'
          + 'Current step: ' + (prepared.checkpoint.currentStepId || 'none') + '\n'
          + (call
            ? 'Provider operation: ' + call.transport.server + '/'
              + call.transport.operation + '\n'
              + 'Native host tool: ' + call.transport.tool + '\n'
              + 'Exact call ID: ' + call.id + '\n'
            : 'Host request emitted: no\n')
          + 'Durable checkpoint: ' + prepared.checkpointPath + '\n'
          + 'Connected write approval accepted by this command: no\n'
      );
    }
    if (!['requested', 'completed'].includes(prepared.checkpoint.state)) process.exitCode = 1;
    return;
  }

  if (command === 'plan-complete') {
    if (option(args, '--output')) {
      throw new Error(
        'Operation plan checkpoints are private runtime state and cannot be exported into the repository.'
      );
    }
    const completed = await completeDurableOperationPlanExecution({
      root,
      checkpointId: requiredOption(args, '--checkpoint'),
      callId: requiredOption(args, '--call'),
      response: readPrivateJsonInput(root, requiredOption(args, '--response')),
      at: createdAt
    });
    if (json) {
      print(completed);
    } else {
      const call = completed.currentCall;
      process.stdout.write(
        'Advanced operation plan ' + completed.checkpoint.plan.id + ' to state '
          + completed.checkpoint.state + '.\n'
          + 'Current step: ' + (completed.checkpoint.currentStepId || 'none') + '\n'
          + (call
            ? 'Next provider operation: ' + call.transport.server + '/'
              + call.transport.operation + '\n'
              + 'Next native host tool: ' + call.transport.tool + '\n'
              + 'Next exact call ID: ' + call.id + '\n'
            : 'Next host request emitted: no\n')
          + 'Raw provider response persisted by Core: no\n'
      );
    }
    if (!['requested', 'completed'].includes(completed.checkpoint.state)) process.exitCode = 1;
    return;
  }

  if (command === 'context-connected-prepare') {
    const prepared = await prepareMeetingIntakeConnectedContext({
      root,
      lockPath: requiredOption(args, '--lock'),
      runPath: requiredOption(args, '--run'),
      snapshotId: option(
        args,
        '--snapshot-id',
        'context.meeting-intake.connected.' + idPart
      ),
      meetingId: requiredOption(args, '--meeting-id'),
      recordingUri: requiredOption(args, '--recording-uri'),
      at: createdAt
    });
    if (json) {
      print(prepared);
    } else {
      const call = prepared.currentCall;
      process.stdout.write(
        'Prepared connected meeting-intake context ' + prepared.checkpoint.plan.id
          + ' in state ' + prepared.checkpoint.state + '.\n'
          + 'Current source: ' + (prepared.checkpoint.currentStepId || 'none') + '\n'
          + (call
            ? 'Provider operation: ' + call.transport.server + '/'
              + call.transport.operation + '\n'
              + 'Native host tool: ' + call.transport.tool + '\n'
              + 'Exact call ID: ' + call.id + '\n'
            : 'Host request emitted: no\n')
          + 'Durable checkpoint: ' + prepared.checkpointPath + '\n'
          + 'Connected write approval accepted by this command: no\n'
      );
    }
    if (!['requested', 'completed'].includes(prepared.checkpoint.state)) process.exitCode = 1;
    return;
  }

  if (command === 'context-connected-finalize') {
    const finalized = finalizeMeetingIntakeConnectedContext({
      root,
      checkpointId: requiredOption(args, '--checkpoint')
    });
    if (json) {
      print(finalized);
    } else {
      process.stdout.write(
        'Finalized connected context snapshot ' + finalized.snapshot.id + '.\n'
          + 'Entries: ' + finalized.snapshot.entries.length + '\n'
          + 'Containment: ' + finalized.snapshot.containment + '\n'
          + 'Run state: ' + finalized.run.lifecycleState + '\n'
          + 'Private snapshot: ' + finalized.snapshotPath + '\n'
          + 'External writes executed: 0\n'
      );
    }
    return;
  }

  if (command === 'host-fail') {
    const failed = failDurableHostExecution({
      root,
      checkpointId: requiredOption(args, '--checkpoint'),
      errorKind: requiredOption(args, '--kind'),
      message: requiredOption(args, '--message'),
      callId: option(args, '--call'),
      at: createdAt
    });
    const output = option(args, '--output');
    if (output) writeJson(resolveRepoPath(root, output), failed.checkpoint);
    if (json) {
      print(failed);
    } else {
      process.stdout.write(
        'Recorded ' + failed.checkpoint.id + ' in state '
          + failed.checkpoint.state + '.\n'
          + (output ? 'Wrote: ' + output + '\n' : '')
      );
    }
    return;
  }

  if (command === 'host-get') {
    const checkpoint = getDurableHostExecution({
      root,
      checkpointId: requiredOption(args, '--checkpoint')
    });
    print(checkpoint);
    return;
  }

  if (command === 'host-list') {
    const checkpoints = listDurableHostExecutions({
      root,
      state: option(args, '--state')
    });
    print(checkpoints);
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
    'Usage: node soter/core/cli.mjs <resolve|prepare|context|context-connected-prepare|context-connected-finalize|transaction|doctor|probe-prepare|probe-complete|capability-prepare|capability-complete|plan-prepare|plan-complete|host-fail|host-get|host-list|fixtures|selftest> [options]\n'
      + '  resolve [--config PATH] [--output PATH] [--json]\n'
      + '  prepare --lock PATH [--scenario PATH] [--output PATH] [--evidence-dir PATH] [--json]\n'
      + '  context --lock PATH --meeting-id ID --recording-uri URI [--scenario PATH] [--json]\n'
      + '  context-connected-prepare --lock PATH --run PATH --meeting-id ID --recording-uri URI [--snapshot-id ID] [--json]\n'
      + '  context-connected-finalize --checkpoint ID [--json]\n'
      + '  transaction --lock PATH [--scenario PATH] [--approve] [--json]\n'
      + '  doctor --lock PATH [--level offline|connected] [--probe PATH ...] [--probe-checkpoint ID ...] [--config PATH] [--json]\n'
      + '  probe-prepare --lock PATH --provider ID [--output PATH] [--json]\n'
      + '  probe-complete --checkpoint ID --response ABSOLUTE_PRIVATE_PATH [--probe-output PATH] [--json]\n'
      + '  capability-prepare --lock PATH --run PATH --capability ID --authority ID --provider ID --input PATH [--output PATH] [--json]\n'
      + '  capability-complete --checkpoint ID --response ABSOLUTE_PRIVATE_PATH [--output PATH] [--json]\n'
      + '  plan-prepare --lock PATH --run PATH --plan ABSOLUTE_PRIVATE_PATH [--json]\n'
      + '  plan-complete --checkpoint ID --call ID --response ABSOLUTE_PRIVATE_PATH [--json]\n'
      + '  host-fail --checkpoint ID [--call ID] --kind KIND --message TEXT [--output PATH] [--json]\n'
      + '  host-get --checkpoint ID\n'
      + '  host-list [--state requested|completed|failed|blocked]\n'
      + '  fixtures <--check|--update> [--json]'
  );
}

main().catch((error) => {
  process.stderr.write('Soter Core: ' + error.message + '\n');
  process.exitCode = 1;
});
