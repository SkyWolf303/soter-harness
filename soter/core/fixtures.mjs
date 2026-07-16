import fs from 'node:fs';
import path from 'node:path';

import { runConnectedDoctor, runOfflineDoctor } from './doctor.mjs';
import { assembleMeetingIntakeContext } from './context.mjs';
import {
  createContextAssemblyEvidence,
  createContainedTransactionEvidence,
  createResolutionEvidence,
  createRunPreparationEvidence
} from './evidence.mjs';
import { canonicalJson, readJson, writeJson } from './lib/canonical-json.mjs';
import { resolveConfiguration } from './resolve.mjs';
import { prepareRunEnvelope } from './run.mjs';
import { runContainedMeetingIntakeTransaction } from '../automations/meeting-intake/transaction.mjs';

export const MEETING_INTAKE_FIXTURE_TIME = '2026-07-15T12:00:00.000Z';

export async function buildMeetingIntakeFixtures(root) {
  const lockPath = 'soter/fixtures/meeting-intake/meeting-intake.lock.json';
  const resolutionEvidenceId = 'evidence.meeting-intake.resolution.fixture';
  const preparationEvidenceId = 'evidence.meeting-intake.preparation.fixture';
  const contextEvidenceId = 'evidence.meeting-intake.context.fixture';
  const transactionEvidenceId = 'evidence.meeting-intake.transaction.fixture';
  const lock = resolveConfiguration({
    root,
    configPath: 'soter/configurations/meeting-intake.config.json'
  });
  const envelope = prepareRunEnvelope({
    root,
    lock,
    lockPath,
    scenarioPath: 'soter/scenarios/meeting-intake/happy-path.scenario.json',
    runId: 'run.meeting-intake.fixture',
    createdAt: MEETING_INTAKE_FIXTURE_TIME,
    evidenceIds: [resolutionEvidenceId, preparationEvidenceId]
  });
  const resolutionEvidence = createResolutionEvidence({
    lock,
    id: resolutionEvidenceId,
    createdAt: MEETING_INTAKE_FIXTURE_TIME
  });
  const preparationEvidence = createRunPreparationEvidence({
    lock,
    envelope,
    id: preparationEvidenceId,
    createdAt: MEETING_INTAKE_FIXTURE_TIME
  });
  const doctor = runOfflineDoctor({
    root,
    lock,
    doctorId: 'doctor.meeting-intake.fixture',
    evidenceId: resolutionEvidenceId,
    createdAt: MEETING_INTAKE_FIXTURE_TIME
  });
  if (doctor.evidence.length !== 1
    || canonicalJson(doctor.evidence[0]) !== canonicalJson(resolutionEvidence)) {
    throw new Error('Offline doctor did not reproduce the shared resolution evidence record.');
  }
  const connectedDoctor = runConnectedDoctor({
    root,
    lock,
    doctorId: 'doctor.meeting-intake.connected-fixture',
    evidenceId: resolutionEvidenceId,
    createdAt: MEETING_INTAKE_FIXTURE_TIME,
    providerProbes: []
  });
  if (connectedDoctor.evidence.length !== 1
    || canonicalJson(connectedDoctor.evidence[0]) !== canonicalJson(resolutionEvidence)) {
    throw new Error('Connected doctor did not reproduce the shared resolution evidence record.');
  }
  const contained = await assembleMeetingIntakeContext({
    root,
    lock,
    lockPath,
    scenarioPath: 'soter/scenarios/meeting-intake/happy-path.scenario.json',
    runId: 'run.meeting-intake.contained-fixture',
    snapshotId: 'context.meeting-intake.contained-fixture',
    createdAt: MEETING_INTAKE_FIXTURE_TIME,
    meetingId: 'meeting.fixture-001',
    recordingUri: 'otter://fixture/meeting.fixture-001',
    evidenceIds: [resolutionEvidenceId, contextEvidenceId]
  });
  const contextEvidence = createContextAssemblyEvidence({
    lock,
    envelope: contained.envelope,
    snapshot: contained.snapshot,
    id: contextEvidenceId,
    createdAt: MEETING_INTAKE_FIXTURE_TIME
  });
  const transaction = await runContainedMeetingIntakeTransaction({
    root,
    lock,
    lockPath,
    scenarioPath: 'soter/scenarios/meeting-intake/happy-path.scenario.json',
    runId: 'run.meeting-intake.transaction-fixture',
    snapshotId: 'context.meeting-intake.transaction-fixture',
    changeSetId: 'changeset.meeting-intake.transaction-fixture',
    approvalId: 'approval.meeting-intake.transaction-fixture',
    createdAt: MEETING_INTAKE_FIXTURE_TIME,
    actor: 'fixture.user',
    approved: true,
    evidenceIds: [resolutionEvidenceId, transactionEvidenceId]
  });
  const transactionEvidence = createContainedTransactionEvidence({
    lock,
    envelope: transaction.envelope,
    changeSet: transaction.changeSet,
    approval: transaction.approval,
    id: transactionEvidenceId,
    createdAt: MEETING_INTAKE_FIXTURE_TIME
  });

  return new Map([
    [lockPath, lock],
    ['soter/fixtures/meeting-intake/preflight.run.json', envelope],
    ['soter/fixtures/meeting-intake/resolution.evidence.json', resolutionEvidence],
    ['soter/fixtures/meeting-intake/preparation.evidence.json', preparationEvidence],
    ['soter/fixtures/meeting-intake/offline.doctor.json', doctor.report],
    ['soter/fixtures/meeting-intake/connected.doctor.json', connectedDoctor.report],
    ['soter/fixtures/meeting-intake/contained.run.json', contained.envelope],
    ['soter/fixtures/meeting-intake/contained.context.json', contained.snapshot],
    ['soter/fixtures/meeting-intake/contained.evidence.json', contextEvidence],
    ['soter/fixtures/meeting-intake/transaction.run.json', transaction.envelope],
    ['soter/fixtures/meeting-intake/transaction.context.json', transaction.snapshot],
    ['soter/fixtures/meeting-intake/transaction.changeset.json', transaction.changeSet],
    ['soter/fixtures/meeting-intake/transaction.approval.json', transaction.approval],
    ['soter/fixtures/meeting-intake/transaction.evidence.json', transactionEvidence]
  ]);
}

export async function checkMeetingIntakeFixtures(root) {
  const expected = await buildMeetingIntakeFixtures(root);
  const mismatches = [];
  for (const [relativePath, value] of expected) {
    const file = path.join(root, relativePath);
    if (!fs.existsSync(file)) {
      mismatches.push({ path: relativePath, reason: 'missing' });
      continue;
    }
    let observed;
    try {
      observed = readJson(file);
    } catch (error) {
      mismatches.push({ path: relativePath, reason: 'invalid JSON: ' + error.message });
      continue;
    }
    if (canonicalJson(observed) !== canonicalJson(value)) {
      mismatches.push({ path: relativePath, reason: 'stale' });
    }
  }
  return { matches: mismatches.length === 0, mismatches, expected };
}

export async function writeMeetingIntakeFixtures(root) {
  const fixtures = await buildMeetingIntakeFixtures(root);
  for (const [relativePath, value] of fixtures) {
    writeJson(path.join(root, relativePath), value);
  }
  return fixtures;
}
