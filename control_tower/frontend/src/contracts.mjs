const OK = Object.freeze({ ok: true, code: 'ok', path: '$' });

export const VALIDATION_CODES = Object.freeze([
  'ok',
  'identifier_missing',
  'identifier_mismatch',
  'contract_version_unsupported',
  'capability_version_unsupported',
  'secret_key_forbidden',
  'field_status_invalid',
  'decision_rule_missing',
  'event_sequence_not_monotonic',
  'fingerprint_mismatch',
  'schema_invalid',
]);

function failure(code, path) {
  return Object.freeze({ ok: false, code, path });
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function strings(value) {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function normalizedKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function forbiddenKey(value, environment, currentPath = '$') {
  const forbidden = new Set(strings(environment.catalog.forbiddenSecretKeyAliases).map(normalizedKey));
  const allowed = new Set(strings(environment.catalog.allowedSecretLikeKeys).map(normalizedKey));
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const nested = forbiddenKey(value[index], environment, `${currentPath}[${index}]`);
      if (nested !== null) return nested;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${currentPath}.${key}`;
    const normalized = normalizedKey(key);
    if ([...forbidden].some((secret) => normalized.includes(secret)) && !allowed.has(normalized)) return childPath;
    const nested = forbiddenKey(child, environment, childPath);
    if (nested !== null) return nested;
  }
  return null;
}

function schemaTypes(value) {
  const known = new Set(['array', 'boolean', 'integer', 'null', 'number', 'object', 'string']);
  if (typeof value === 'string') return known.has(value) ? [value] : [];
  return Array.isArray(value) ? value.flatMap(schemaTypes) : [];
}

function matchesType(value, schemaType) {
  switch (schemaType) {
    case 'array': return Array.isArray(value);
    case 'boolean': return typeof value === 'boolean';
    case 'integer': return Number.isInteger(value);
    case 'null': return value === null;
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'object': return isRecord(value);
    case 'string': return typeof value === 'string';
    default: throw new TypeError(`Unsupported schema type: ${schemaType}`);
  }
}

function resolveRef(reference, base, environment) {
  const separator = reference.indexOf('#');
  const fileName = separator < 0 ? reference : reference.slice(0, separator);
  const fragment = separator < 0 ? '' : reference.slice(separator + 1);
  const targetName = fileName || base;
  let target = environment.schemas[targetName];
  if (!isRecord(target)) return null;
  const parts = fragment.length === 0 ? [] : fragment.replace(/^\//, '').split('/');
  for (const rawPart of parts) {
    const part = rawPart.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!isRecord(target) || !(part in target)) return null;
    target = target[part];
  }
  return isRecord(target) ? { schema: target, base: targetName } : null;
}

function schemaError(value, schema, cursor) {
  const { currentPath, base, environment } = cursor;
  if (typeof schema.$ref === 'string') {
    const resolved = resolveRef(schema.$ref, base, environment);
    return resolved === null
      ? currentPath
      : schemaError(value, resolved.schema, { currentPath, base: resolved.base, environment });
  }
  if (Array.isArray(schema.anyOf)) {
    for (const alternative of schema.anyOf) {
      if (isRecord(alternative) && schemaError(value, alternative, cursor) === null) return null;
    }
    return currentPath;
  }
  const types = schemaTypes(schema.type);
  if (types.length > 0 && !types.some((schemaType) => matchesType(value, schemaType))) return currentPath;
  if (Object.hasOwn(schema, 'const') && value !== schema.const) return currentPath;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return currentPath;
  if (typeof value === 'string') {
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) return currentPath;
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) return currentPath;
    return typeof schema.pattern === 'string' && !(new RegExp(schema.pattern)).test(value) ? currentPath : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return currentPath;
    return typeof schema.maximum === 'number' && value > schema.maximum ? currentPath : null;
  }
  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) return currentPath;
    if (isRecord(schema.items)) {
      for (let index = 0; index < value.length; index += 1) {
        const invalid = schemaError(value[index], schema.items, { currentPath: `${currentPath}[${index}]`, base, environment });
        if (invalid !== null) return invalid;
      }
    }
    return null;
  }
  if (!isRecord(value)) return null;
  if (Array.isArray(schema.required)) {
    for (const key of schema.required) {
      if (typeof key === 'string' && !Object.hasOwn(value, key)) return `${currentPath}.${key}`;
    }
  }
  if (!isRecord(schema.properties)) return null;
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties, key)) return `${currentPath}.${key}`;
    }
  }
  for (const [key, childSchema] of Object.entries(schema.properties)) {
    if (Object.hasOwn(value, key) && isRecord(childSchema)) {
      const invalid = schemaError(value[key], childSchema, { currentPath: `${currentPath}.${key}`, base, environment });
      if (invalid !== null) return invalid;
    }
  }
  return null;
}

function proofIsExactOne(value) {
  return isRecord(value)
    && value.proofType === 'validated-candidate-count'
    && value.validatedCandidateCount === 1
    && Array.isArray(value.evidenceRefs)
    && value.evidenceRefs.length > 0;
}

function decisionError(document, contractType, environment) {
  if (contractType === 'decision-point-registry' && Array.isArray(document.entries)) {
    const registered = new Set(strings(document.registeredJudgeIds));
    for (let index = 0; index < document.entries.length; index += 1) {
      const entry = document.entries[index];
      if (isRecord(entry) && entry.decisionMode === 'auto') {
        const registeredJudge = typeof entry.judgeId === 'string' && registered.has(entry.judgeId);
        if (!registeredJudge && !proofIsExactOne(entry.exactOneProof)) return `$.entries[${index}]`;
      }
    }
  }
  if (contractType === 'stage-policy-snapshot' && isRecord(document.decisionRule)) {
    const rule = document.decisionRule;
    if (rule.decisionMode === 'auto') {
      const registered = new Set(strings(environment.catalog.registeredJudgeIds));
      const registeredJudge = typeof rule.judgeId === 'string' && registered.has(rule.judgeId);
      if (!registeredJudge && !proofIsExactOne(rule.exactOneProof)) return '$.decisionRule';
    }
  }
  return null;
}

function echoError(document, environment) {
  const reference = environment.context.referenceEnvelope;
  if (!isRecord(reference)) return failure('identifier_missing', '$.referenceEnvelope');
  const expectedFingerprint = environment.context.expectedInputImageFingerprint;
  if (typeof expectedFingerprint !== 'string') return failure('identifier_missing', '$.expectedInputImageFingerprint');
  if (document.inputImageFingerprint !== expectedFingerprint) return failure('fingerprint_mismatch', '$.inputImageFingerprint');
  for (const key of strings(environment.catalog.identifierFields)) {
    if (!Object.hasOwn(reference, key)) return failure('identifier_missing', `$.referenceEnvelope.${key}`);
    if (key !== 'inputImageFingerprint' && document[key] !== reference[key]) return failure('identifier_mismatch', `$.${key}`);
  }
  const previous = environment.context.previousEventSequence;
  const sequence = document.eventSequence;
  if (!Number.isInteger(previous)) return failure('identifier_missing', '$.previousEventSequence');
  if (!Number.isInteger(sequence) || sequence <= 0 || sequence <= previous) {
    return failure('event_sequence_not_monotonic', '$.eventSequence');
  }
  return null;
}

export function validateContract(payload, environment) {
  if (!isRecord(payload) || !isRecord(environment) || !isRecord(environment.catalog) || !isRecord(environment.schemas)) {
    return failure('schema_invalid', '$');
  }
  const normalizedEnvironment = Object.freeze({
    catalog: environment.catalog,
    schemas: environment.schemas,
    context: isRecord(environment.context) ? environment.context : Object.freeze({}),
  });
  const forbiddenPath = forbiddenKey(payload, normalizedEnvironment);
  if (forbiddenPath !== null) return failure('secret_key_forbidden', forbiddenPath);
  if (!Object.hasOwn(payload, 'contractVersion') || payload.contractVersion === null) return failure('identifier_missing', '$.contractVersion');
  if (!strings(normalizedEnvironment.catalog.supportedContractVersions).includes(payload.contractVersion)) return failure('contract_version_unsupported', '$.contractVersion');
  if (!Object.hasOwn(payload, 'capabilityVersion') || payload.capabilityVersion === null) return failure('identifier_missing', '$.capabilityVersion');
  const capabilityCatalog = normalizedEnvironment.catalog.capabilityCatalog;
  if (!isRecord(capabilityCatalog) || !Object.hasOwn(capabilityCatalog, payload.capabilityVersion)) return failure('capability_version_unsupported', '$.capabilityVersion');
  const contractType = payload.contractType;
  const contractSchemas = normalizedEnvironment.catalog.contractSchemas;
  if (typeof contractType !== 'string' || !isRecord(contractSchemas) || !Object.hasOwn(contractSchemas, contractType)) {
    return failure('schema_invalid', '$.contractType');
  }
  const echoTypes = strings(normalizedEnvironment.catalog.echoContractTypes);
  if (contractType === 'work-order' || echoTypes.includes(contractType)) {
    for (const key of strings(normalizedEnvironment.catalog.identifierFields)) {
      if (!Object.hasOwn(payload, key) || payload[key] === null || payload[key] === '') return failure('identifier_missing', `$.${key}`);
    }
  }
  if (contractType === 'work-order' && isRecord(payload.operation) && typeof payload.operation.capability === 'string'
    && !strings(capabilityCatalog[payload.capabilityVersion]).includes(payload.operation.capability)) {
    return failure('capability_version_unsupported', '$.operation.capability');
  }
  if (contractType === 'field-record' && !strings(normalizedEnvironment.catalog.fieldStatuses).includes(payload.status)) {
    return failure('field_status_invalid', '$.status');
  }
  const decisionPath = decisionError(payload, contractType, normalizedEnvironment);
  if (decisionPath !== null) return failure('decision_rule_missing', decisionPath);
  if (echoTypes.includes(contractType)) {
    const invalidEcho = echoError(payload, normalizedEnvironment);
    if (invalidEcho !== null) return invalidEcho;
  }
  const schemaName = contractSchemas[contractType];
  if (typeof schemaName !== 'string' || !isRecord(normalizedEnvironment.schemas[schemaName])) {
    return failure('schema_invalid', '$.contractType');
  }
  const invalidPath = schemaError(payload, normalizedEnvironment.schemas[schemaName], { currentPath: '$', base: schemaName, environment: normalizedEnvironment });
  return invalidPath === null ? OK : failure('schema_invalid', invalidPath);
}
