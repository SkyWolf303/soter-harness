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
    return mapping?.$contract === 'soter://contracts/provider-mapping/v1'
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

export function completeMcp({ capability, authority, response, at, mappings }) {
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
