import { fingerprintJson } from '../../core/lib/canonical-json.mjs';

function providerError(kind, message) {
  const error = new Error(message);
  error.kind = kind;
  return error;
}

function requiredObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw providerError('validation', label + ' must be an object.');
  }
  return value;
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw providerError('validation', label + ' must be a non-empty string.');
  }
  return value;
}

function parseJsonText(value, label) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    throw providerError('validation', label + ' did not contain valid JSON.');
  }
}

function nativePayload(response) {
  if (response?.isError === true) {
    throw providerError('unknown', 'The Notion host tool returned an error result.');
  }
  const direct = response?.structuredContent?.result ?? response?.result;
  if (direct !== undefined) return parseJsonText(direct, 'Notion structured result');
  const text = response?.content?.find((item) => item?.type === 'text')?.text;
  if (text !== undefined) return parseJsonText(text, 'Notion text result');
  throw providerError('validation', 'Notion did not return a structured or JSON text result.');
}

function mappingDocument(mappings, capability) {
  const matches = (mappings || []).filter((mapping) => {
    return (mapping?.$contract === 'soter://contracts/provider-mapping/v1'
      || mapping?.$contract === 'soter://contracts/provider-mapping/v2')
      && mapping.capabilities?.includes(capability);
  });
  if (matches.length !== 1) {
    throw providerError(
      'validation',
      'Expected one provider mapping for ' + capability + '; found ' + matches.length + '.'
    );
  }
  return matches[0];
}

function notionSettings(settings) {
  const configured = requiredObject(settings?.['integration.notion'], 'integration.notion settings');
  return requiredObject(configured.targets, 'integration.notion.targets');
}

function sqlIdentifier(value) {
  return '"' + String(value).replaceAll('"', '""') + '"';
}

function sqlString(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}

function recordMapping(mapping, type) {
  const matches = mapping.recordTypes.filter((item) => item.id === type);
  if (matches.length !== 1) {
    throw providerError('validation', 'Notion mapping does not declare record type ' + type + '.');
  }
  return matches[0];
}

function requestLimit(input) {
  const value = input.limit ?? 50;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw providerError('validation', 'Notion record reads require limit from 1 through 100.');
  }
  return value;
}

function selectForType({ definition, target, input, params }) {
  const fieldSql = definition.fields.flatMap((field) => {
    return [sqlString(field.portable), sqlIdentifier(field.provider)];
  }).join(', ');
  const clauses = [];
  if (input.ids) {
    clauses.push('url IN (' + input.ids.map(() => '?').join(', ') + ')');
    params.push(...input.ids);
  }
  for (const [portable, value] of Object.entries(input.filters || {})) {
    const fields = definition.fields.filter((field) => field.portable === portable);
    if (fields.length !== 1) {
      throw providerError(
        'validation',
        'Notion mapping does not expose filter field ' + portable + ' for ' + definition.id + '.'
      );
    }
    clauses.push(sqlIdentifier(fields[0].provider) + ' = ?');
    params.push(String(value));
  }
  return 'SELECT '
    + sqlString(definition.id) + ' AS "__soterType", '
    + 'url AS "__soterId", '
    + 'json_object(' + fieldSql + ') AS "__soterFields" '
    + 'FROM ' + sqlIdentifier(target)
    + (clauses.length ? ' WHERE ' + clauses.join(' AND ') : '');
}

export function prepareMcp({ capability, input, settings, mappings }) {
  if (capability !== 'crm.records.read') {
    throw providerError('validation', 'Notion MCP read adapter does not implement ' + capability + '.');
  }
  if (!Array.isArray(input.recordTypes) || input.recordTypes.length !== 1) {
    throw providerError(
      'validation',
      'Connected Notion record reads currently require exactly one record type per host call; Core must orchestrate multiple targets without relying on plan-gated cross-data-source SQL.'
    );
  }
  if (input.ids && (!Array.isArray(input.ids)
    || input.ids.length < 1
    || input.ids.length > 100
    || input.ids.some((id) => typeof id !== 'string' || !id.trim()))) {
    throw providerError('validation', 'Notion record ids must contain 1 through 100 non-empty strings.');
  }
  requiredObject(input.filters || {}, 'Notion record filters');
  const mapping = mappingDocument(mappings, capability);
  const targets = notionSettings(settings);
  const params = [];
  const targetUris = [];
  const selects = input.recordTypes.map((type) => {
    const definition = recordMapping(mapping, type);
    const target = requiredString(targets[definition.target], 'Notion target ' + definition.target);
    if (!/^collection:\/\/[a-f0-9-]{32,36}$/.test(target)) {
      throw providerError('validation', 'Notion target ' + definition.target + ' is not a collection URI.');
    }
    targetUris.push(target);
    return selectForType({ definition, target, input, params });
  });
  const data = {
    mode: 'sql',
    data_source_urls: [...new Set(targetUris)],
    query: selects.join(' UNION ALL ') + ' LIMIT ' + requestLimit(input)
  };
  if (params.length) data.params = params;
  return { tool: 'query_data_sources', arguments: { data } };
}

function decodedFields(mapping, row) {
  const definition = recordMapping(mapping, row.__soterType);
  const raw = requiredObject(
    parseJsonText(row.__soterFields, 'Notion normalized field envelope'),
    'Notion normalized field envelope'
  );
  const fields = {};
  for (const field of definition.fields) {
    const value = raw[field.portable];
    fields[field.portable] = field.decode === 'json' && value !== null
      ? parseJsonText(value, 'Notion field ' + field.portable)
      : value;
  }
  return fields;
}

function assertRequestedRecords(records, input) {
  const requestedTypes = new Set(input.recordTypes);
  const requestedIds = input.ids ? new Set(input.ids) : null;
  const ids = records.map((record) => record.id);
  if (records.length > requestLimit(input)
    || new Set(ids).size !== ids.length
    || records.some((record) => !requestedTypes.has(record.type))
    || (requestedIds && records.some((record) => !requestedIds.has(record.id)))) {
    throw providerError(
      'validation',
      'Notion returned duplicate records or records outside the exact requested type, id, or limit.'
    );
  }
  for (const record of records) {
    for (const [field, value] of Object.entries(input.filters || {})) {
      if (String(record.fields[field]) !== String(value)) {
        throw providerError(
          'validation',
          'Notion returned a record that does not match requested filter ' + field + '.'
        );
      }
    }
  }
}

export function completeMcp({ capability, authority, input, response, at, mappings }) {
  if (capability !== 'crm.records.read') {
    throw providerError('validation', 'Notion MCP read adapter does not implement ' + capability + '.');
  }
  const mapping = mappingDocument(mappings, capability);
  const payload = requiredObject(nativePayload(response), 'Notion query result');
  if (!Array.isArray(payload.results) || typeof payload.has_more !== 'boolean') {
    throw providerError('validation', 'Notion query result must contain results and has_more.');
  }
  if (payload.has_more) {
    throw providerError(
      'validation',
      'Notion query pagination is incomplete; Core must resume a bounded continuation before using these records.'
    );
  }
  const records = payload.results.map((row, index) => {
    requiredObject(row, 'Notion result row ' + index);
    const type = requiredString(row.__soterType, 'Notion result type');
    const id = requiredString(row.__soterId, 'Notion result id');
    const fields = decodedFields(mapping, row);
    return {
      type,
      id,
      version: fingerprintJson({ type, id, fields }),
      fields
    };
  });
  assertRequestedRecords(records, input);
  return {
    records,
    provenance: {
      provider: 'notion-mcp',
      authority,
      mapping: mapping.id,
      mappingVersion: mapping.version
    },
    observedAt: at
  };
}

export function prepareProbeMcp() {
  return {
    tool: 'fetch',
    arguments: { id: 'self' }
  };
}

export function completeProbeMcp({ response, plan }) {
  const payload = requiredObject(nativePayload(response), 'Notion identity result');
  if (payload?.metadata?.type !== 'self'
    || typeof payload?.self?.workspace?.id !== 'string'
    || typeof payload?.self?.user?.id !== 'string') {
    throw providerError(
      'authentication',
      'Notion fetch(self) did not return an authenticated workspace and user identity.'
    );
  }
  return {
    credentials: plan.credentialRefs.map((secretRefId) => ({
      secretRefId,
      state: 'passed',
      details: 'The host-authenticated Notion identity endpoint returned a workspace and user.'
    })),
    reachability: {
      state: 'passed',
      details: 'The host reached Notion fetch(self) and received a structured identity response.'
    },
    authorities: plan.authorities.map((id) => ({
      id,
      state: 'unknown',
      details: 'Workspace identity does not establish access to the configured CRM target for this authority.'
    })),
    capabilities: plan.capabilities.map((id) => ({
      id,
      state: 'unknown',
      method: 'metadata',
      details: 'Identity metadata does not establish current target schema compatibility or bounded record-read behavior.'
    })),
    limitations: [
      'This identity-only probe establishes host authentication and endpoint reachability, not access to configured data sources, schema compatibility, record normalization, or end-to-end health.',
      'The provider response body and returned identity values are excluded; only typed observations and fingerprints may persist.'
    ]
  };
}

function typedMapping(mappings) {
  const mapping = mappingDocument(mappings, 'crm.records.read');
  if (mapping.$contract !== 'soter://contracts/provider-mapping/v2'
    || mapping.recordTypes.some((record) => {
      return record.fields.some((field) => typeof field.providerType !== 'string');
    })) {
    throw providerError(
      'validation',
      'Notion schema probes require a typed provider mapping contract.'
    );
  }
  return mapping;
}

function sortedFieldSignature(fields) {
  return fields.map((field) => ({
    provider: field.provider,
    providerType: field.providerType
  })).sort((left, right) => left.provider.localeCompare(right.provider, 'en'));
}

function dataSourceState(payload, targetUri) {
  if (payload?.metadata?.type !== 'data_source' || typeof payload.text !== 'string') {
    throw providerError('validation', 'Notion fetch target did not return data-source metadata.');
  }
  const source = payload.text.match(/<data-source\s+url="([^"]+)">/);
  const state = payload.text.match(/<data-source-state>\s*([\s\S]*?)\s*<\/data-source-state>/);
  const sourceUri = source?.[1]?.replace(/^\{\{/, '').replace(/\}\}$/, '');
  if (sourceUri !== targetUri || !state?.[1]) {
    throw providerError(
      'validation',
      'Notion fetch target did not identify the exact configured data source.'
    );
  }
  const parsed = requiredObject(
    parseJsonText(state[1], 'Notion data-source state'),
    'Notion data-source state'
  );
  return requiredObject(parsed.schema, 'Notion data-source schema');
}

function schemaObservation(step, response) {
  const schema = dataSourceState(
    requiredObject(nativePayload(response), 'Notion data-source result'),
    step.scope.targetUri
  );
  const expected = step.scope.expectedFields;
  const observed = expected.map((field) => {
    const property = requiredObject(
      schema[field.provider],
      'Notion mapped property ' + field.provider
    );
    if (property.name !== field.provider || property.type !== field.providerType) {
      throw providerError(
        'validation',
        'Notion mapped property ' + field.provider + ' expected type '
          + field.providerType + ' but observed ' + String(property.type) + '.'
      );
    }
    return { provider: property.name, providerType: property.type };
  }).sort((left, right) => left.provider.localeCompare(right.provider, 'en'));
  const expectedSignature = sortedFieldSignature(expected);
  return {
    schemaCompatible: true,
    mappedFieldCount: observed.length,
    expectedFingerprint: fingerprintJson(expectedSignature),
    observedFingerprint: fingerprintJson(observed)
  };
}

export function prepareProbePlanMcp({ plan, settings, mappings }) {
  const mapping = typedMapping(mappings);
  const targets = notionSettings(settings);
  const steps = [
    {
      id: 'step.identity',
      kind: 'identity',
      subject: 'provider.identity',
      scope: {
        expectation: {
          metadataType: 'self',
          workspaceIdType: 'string',
          userIdType: 'string'
        }
      },
      tool: 'fetch',
      arguments: { id: 'self' }
    }
  ];
  for (const record of mapping.recordTypes) {
    const targetUri = requiredString(
      targets[record.target],
      'Notion target ' + record.target
    );
    if (!/^collection:\/\/[a-f0-9-]{32,36}$/.test(targetUri)) {
      throw providerError('validation', 'Notion target ' + record.target + ' is not a collection URI.');
    }
    const expectedFields = record.fields.map((field) => ({
      portable: field.portable,
      provider: field.provider,
      providerType: field.providerType,
      decode: field.decode
    }));
    steps.push({
      id: 'step.target.' + record.target + '.schema',
      kind: 'schema',
      subject: 'target.' + record.target,
      scope: {
        targetKey: record.target,
        targetUri,
        recordType: record.id,
        mappingId: mapping.id,
        mappingVersion: mapping.version,
        expectedFields
      },
      tool: 'fetch',
      arguments: { id: targetUri }
    });
    const input = { recordTypes: [record.id], filters: {}, limit: 1 };
    const request = prepareMcp({
      capability: 'crm.records.read',
      input,
      settings,
      mappings
    });
    steps.push({
      id: 'step.target.' + record.target + '.read',
      kind: 'read',
      subject: 'target.' + record.target,
      scope: {
        targetKey: record.target,
        targetUri,
        recordType: record.id,
        mappingId: mapping.id,
        mappingVersion: mapping.version,
        input,
        expectation: {
          resultEnvelope: 'bounded-normalized-records',
          maximumRows: 1
        }
      },
      tool: request.tool,
      arguments: request.arguments
    });
  }
  if (!plan.capabilities.includes('crm.records.read')) {
    throw providerError('validation', 'Notion probe plan is outside crm.records.read scope.');
  }
  return { steps };
}

export function completeProbePlanStepMcp({ step, response, plan, mappings, at }) {
  if (step.kind === 'identity') {
    const payload = requiredObject(nativePayload(response), 'Notion identity result');
    if (payload?.metadata?.type !== 'self'
      || typeof payload?.self?.workspace?.id !== 'string'
      || typeof payload?.self?.user?.id !== 'string') {
      throw providerError(
        'authentication',
        'Notion fetch(self) did not return an authenticated workspace and user identity.'
      );
    }
    return {
      identityAuthenticated: true,
      expectedFingerprint: fingerprintJson(step.scope.expectation),
      observedFingerprint: fingerprintJson({
        metadataType: payload.metadata.type,
        workspaceIdType: typeof payload.self.workspace.id,
        userIdType: typeof payload.self.user.id
      })
    };
  }
  if (step.kind === 'schema') return schemaObservation(step, response);
  if (step.kind === 'read') {
    const normalized = completeMcp({
      capability: 'crm.records.read',
      authority: plan.authorities[0],
      input: step.scope.input,
      response,
      at,
      mappings
    });
    return {
      queryAccepted: true,
      normalized: true,
      rowCount: normalized.records.length,
      rowObserved: normalized.records.length > 0,
      expectedFingerprint: fingerprintJson(step.scope.expectation),
      observedFingerprint: fingerprintJson({
        resultEnvelope: 'bounded-normalized-records',
        rowCount: normalized.records.length,
        rowObserved: normalized.records.length > 0
      })
    };
  }
  throw providerError('validation', 'Unsupported Notion provider probe step kind.');
}

export function finalizeProbePlanMcp({ plan, steps, results }) {
  const byStep = new Map(results.map((item) => [item.stepId, item]));
  const checks = steps.map((step) => {
    const observed = byStep.get(step.id);
    if (!observed?.result || typeof observed.resultFingerprint !== 'string') {
      throw providerError('validation', 'Notion provider probe is missing a minimized step result.');
    }
    return {
      id: 'check.' + step.id.slice('step.'.length),
      stepId: step.id,
      kind: step.kind,
      subject: step.subject,
      scopeFingerprint: step.scopeFingerprint,
      state: 'passed',
      method: step.kind === 'read' ? 'read-only' : 'metadata',
      expectedFingerprint: observed.result.expectedFingerprint,
      observedFingerprint: observed.result.observedFingerprint,
      details: step.kind === 'identity'
        ? 'The host-authenticated Notion identity response matched the minimized identity contract.'
        : step.kind === 'schema'
          ? 'The exact configured target exposed every mapped property with its declared provider type.'
          : 'The exact configured target accepted its bounded mapped query and returned a normalizable result envelope.'
    };
  });
  return {
    credentials: plan.credentialRefs.map((secretRefId) => ({
      secretRefId,
      state: 'passed',
      details: 'The host-authenticated Notion identity endpoint returned a workspace and user.'
    })),
    reachability: {
      state: 'passed',
      details: 'The host reached every explicit identity, target-schema, and bounded target-read probe step.'
    },
    authorities: plan.authorities.map((id) => ({
      id,
      state: 'passed',
      details: 'Every exact configured CRM target required by this locked authority scope was schema-compatible and readable.'
    })),
    capabilities: plan.capabilities.map((id) => ({
      id,
      state: 'passed',
      method: 'read-only',
      details: 'Every configured mapped target accepted a one-row bounded query whose result envelope normalized successfully.'
    })),
    checks,
    limitations: [
      'This exact-lock probe establishes current configured target access, mapped schema compatibility, and bounded read-query normalization only; it does not establish write behavior or end-to-end automation health.',
      'A target that returns zero rows proves query and empty-envelope compatibility but does not exercise non-null value decoding for that target.',
      'Raw provider responses, row values, target identifiers, workspace identity values, and user identity values are excluded from the persisted observations.'
    ]
  };
}
