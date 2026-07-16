import { fingerprintJson } from './lib/canonical-json.mjs';
import { fingerprintLock, RESOLVER_VERSION } from './resolve.mjs';

const DEFAULT_RUNTIME = 'node';

function packDependencies(lock) {
  return lock.packs.map((pack) => ({
    id: pack.id,
    version: pack.version,
    fingerprint: pack.manifestFingerprint
  }));
}

function hostSummary(lock) {
  return {
    id: lock.host.id,
    adapter: lock.host.adapter,
    version: lock.host.version,
    manifestFingerprint: lock.host.manifestFingerprint
  };
}

function integrationSummaries(lock) {
  return lock.packs
    .filter((pack) => pack.layer === 'integration')
    .map((pack) => ({
      id: pack.id,
      version: pack.version,
      manifestFingerprint: pack.manifestFingerprint,
      evidenceMaturity: pack.evidenceMaturity
    }));
}

function authoritySummaries(lock) {
  return lock.authorities.map((authority) => ({
    id: authority.id,
    role: authority.role,
    subject: authority.subject,
    declarationFingerprint: authority.declarationFingerprint
  }));
}

function baseEvidence({
  id,
  createdAt,
  claim,
  subject,
  lock,
  evaluator,
  environment,
  acceptanceCriteria,
  result,
  outcomes = [],
  artifacts = [],
  effects = [],
  failures = [],
  warnings = [],
  skipped = [],
  limitations = []
}) {
  return {
    $contract: 'soter://contracts/evidence/v1',
    contractVersion: '1.0.0',
    id,
    createdAt,
    claim,
    subject,
    configurationLockFingerprint: fingerprintLock(lock),
    dependencies: packDependencies(lock),
    host: hostSummary(lock),
    integrations: integrationSummaries(lock),
    authorities: authoritySummaries(lock),
    evaluator,
    environment,
    acceptanceCriteria,
    result,
    outcomes,
    artifacts,
    effects,
    failures,
    warnings,
    skipped,
    limitations,
    freshness: {
      policy: 'Valid only while every configuration-lock fingerprint remains unchanged.',
      validUntil: null
    },
    supersedes: null,
    privacy: {
      scope: 'private',
      redactions: ['Credential references and credential values are excluded.']
    }
  };
}

export function createResolutionEvidence({ lock, id, createdAt }) {
  return baseEvidence({
    id,
    createdAt,
    claim: 'The desired configuration resolves to this exact, internally valid artifact graph.',
    subject: {
      type: 'configuration',
      id: lock.configuration.name,
      version: null
    },
    lock,
    evaluator: {
      id: 'core.resolver',
      version: RESOLVER_VERSION,
      level: 'graph'
    },
    environment: {
      containment: 'offline',
      runtime: DEFAULT_RUNTIME
    },
    acceptanceCriteria: [
      'Kernel validation reports no graph errors.',
      'Every selected pack, capability, host projection, authority, and policy is fingerprinted.',
      'Resolving unchanged inputs produces the same configuration lock fingerprint.',
      'Credential references and values are absent from the lock.'
    ],
    result: 'passed',
    outcomes: [
      { id: 'configuration.graph-resolved', state: 'passed' },
      { id: 'configuration.lock-deterministic', state: 'passed' },
      { id: 'configuration.lock-secret-free', state: 'passed' }
    ],
    artifacts: [
      {
        role: 'configuration',
        path: lock.configuration.path,
        fingerprint: lock.configuration.fingerprint
      },
      {
        role: 'configuration-lock',
        fingerprint: fingerprintLock(lock)
      }
    ],
    skipped: [
      'Host authentication and reachability were not checked offline.',
      'Integration capabilities were not invoked.',
      'Automation outcomes and external effects were not evaluated.'
    ],
    limitations: [
      'This evidence establishes graph validity and reproducibility only; it does not establish readiness, behavior verification, or live health.'
    ]
  });
}

export function createRunPreparationEvidence({ lock, envelope, id, createdAt }) {
  return baseEvidence({
    id,
    createdAt,
    claim: 'The fixture run envelope captures resolved context declarations, bindings, and effect policy without executing effects.',
    subject: {
      type: 'run',
      id: envelope.id,
      version: null
    },
    lock,
    evaluator: {
      id: 'core.run-preparer',
      version: RESOLVER_VERSION,
      level: 'fixture'
    },
    environment: {
      containment: 'fixture',
      runtime: DEFAULT_RUNTIME
    },
    acceptanceCriteria: [
      'The envelope references the exact configuration lock and graph fingerprint.',
      'Every authority declaration records explicit provenance and unknown freshness.',
      'Every selected capability binding and effect policy is present.',
      'No provider capability or external effect is executed during preparation.'
    ],
    result: 'passed',
    outcomes: [
      { id: 'run.envelope-prepared', state: 'passed' },
      { id: 'run.external-effects-executed', state: 'not-applicable' }
    ],
    artifacts: [
      {
        role: 'run-envelope',
        id: envelope.id,
        graphFingerprint: envelope.graphFingerprint
      },
      ...(envelope.scenario ? [{
        role: 'scenario',
        path: envelope.scenario.path,
        fingerprint: envelope.scenario.fingerprint
      }] : [])
    ],
    skipped: [
      'Declared authorities were not loaded from provider systems.',
      'Authentication, provider reachability, and capability behavior were not checked.',
      'Expected scenario outcomes were not claimed or evaluated.'
    ],
    limitations: [
      'Fixture preparation proves envelope construction, not automation behavior or provider conformance.'
    ]
  });
}

export function createContextAssemblyEvidence({ lock, envelope, snapshot, id, createdAt }) {
  return baseEvidence({
    id,
    createdAt,
    claim: 'Fixture providers returned schema-valid CRM and transcript context with explicit authority, provenance, freshness, and effect records.',
    subject: {
      type: 'run',
      id: envelope.id,
      version: null
    },
    lock,
    evaluator: {
      id: 'core.context-assembler',
      version: RESOLVER_VERSION,
      level: 'fixture'
    },
    environment: {
      containment: 'fixture',
      runtime: DEFAULT_RUNTIME
    },
    acceptanceCriteria: [
      'Capability inputs and outputs satisfy their portable schemas.',
      'Each invocation selects one authority allowed by its resolved binding.',
      'Read and disclosure effects pass the configured policy before provider dispatch.',
      'Context values preserve provider provenance, observation time, freshness, and fingerprints.',
      'No connected provider, credential, write capability, or external effect is used.'
    ],
    result: 'passed',
    outcomes: [
      { id: 'context.crm-definition-loaded', state: 'passed' },
      { id: 'context.crm-instances-loaded', state: 'passed' },
      { id: 'context.meeting-transcript-loaded', state: 'passed' },
      { id: 'automation.outcome-executed', state: 'not-applicable' }
    ],
    artifacts: [
      {
        role: 'context-snapshot',
        id: snapshot.id,
        fingerprint: fingerprintJson(snapshot)
      }
    ],
    effects: envelope.effects,
    skipped: [
      'Notion and Otter authentication and network reachability were not checked.',
      'CRM create and update capabilities were not invoked.',
      'Meeting-intake summaries, tasks, links, and project updates were not produced.'
    ],
    limitations: [
      'This evidence proves fixture capability dispatch and context assembly only; it does not establish connected readiness or automation outcome verification.'
    ]
  });
}

export function createContainedTransactionEvidence({
  lock,
  envelope,
  changeSet,
  approval,
  id,
  createdAt
}) {
  return baseEvidence({
    id,
    createdAt,
    claim: 'One exactly approved fixture change set committed atomically and passed read-after-write verification without external effects.',
    subject: { type: 'run', id: envelope.id, version: null },
    lock,
    evaluator: {
      id: 'core.contained-transaction',
      version: RESOLVER_VERSION,
      level: 'fixture'
    },
    environment: { containment: 'fixture', runtime: DEFAULT_RUNTIME },
    acceptanceCriteria: [
      'The approval fingerprint matches the exact proposed operation scope.',
      'No write dispatches before approval.',
      'Create is deduplicated and updates enforce expected versions.',
      'All writes share one checkpoint and expose rollback state.',
      'A read-after-write confirms the source-linked summary and folded meeting-derived task.'
    ],
    result: changeSet.state === 'committed' && changeSet.verification.state === 'passed'
      ? 'passed' : 'failed',
    outcomes: [
      { id: 'meeting-summary.created-once', state: changeSet.verification.state },
      { id: 'grounded-task.folded', state: changeSet.verification.state },
      { id: 'source-meeting.attributed', state: changeSet.verification.state },
      { id: 'external-provider-effect', state: 'not-applicable' }
    ],
    artifacts: [
      { role: 'change-set', id: changeSet.id, fingerprint: fingerprintJson(changeSet) },
      { role: 'approval', id: approval.id, fingerprint: fingerprintJson(approval) }
    ],
    effects: envelope.effects,
    failures: changeSet.state === 'committed' ? [] : ['Contained transaction did not commit.'],
    skipped: [
      'No connected Notion workspace was authenticated or mutated.',
      'No live Otter transcript was read.',
      'Host behavior conformance was not evaluated.'
    ],
    limitations: [
      'This proves transaction mechanics against an in-memory provider fixture, not connected provider semantics or live rollback.'
    ]
  });
}
