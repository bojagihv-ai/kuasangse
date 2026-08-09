const CATALOG_PATH = '/api/invoke/cafe24_control_tower/cafe24-catalog';
const CATEGORY_PATH_TEMPLATE = '/api/v2/admin/categories/{category_no}';
const CAPABILITY = 'cafe24/category-requirements:v1';
const COMMAND_FIELDS = Object.freeze([
  'contractVersion',
  'capabilityVersion',
  'commandId',
  'batchId',
  'productId',
  'productKey',
  'stageId',
  'attempt',
  'issuedAt',
  'deadlineAt',
  'workspaceId',
  'currentRunId',
  'inputImageFingerprint',
  'expectedWorkfileRevision',
  'operationToken',
  'idempotencyKey',
]);
const IDENTITY_FIELDS = Object.freeze([
  'batchId',
  'productId',
  'productKey',
  'workspaceId',
  'currentRunId',
  'inputImageFingerprint',
  'expectedWorkfileRevision',
  'operationToken',
]);

export class Cafe24CategoryRequirementsError extends Error {
  constructor(code) {
    super(code);
    this.name = 'Cafe24CategoryRequirementsError';
    this.code = code;
  }
}

function callable(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function record(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Cafe24CategoryRequirementsError(code);
  }
  return value;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function unsupportedResult(parameters, catalog, unsupportedFields = [], source = null) {
  return Object.freeze({
    status: 'unsupported',
    mallId: parameters.mallId,
    categoryNo: parameters.categoryNo,
    schemaVersion: parameters.expectedSchemaVersion,
    catalogVersion: text(catalog.catalogVersion),
    catalogDigest: text(catalog.catalogDigest),
    requiredFields: Object.freeze([]),
    unsupportedFields: Object.freeze([...new Set(unsupportedFields)]),
    source,
  });
}

function validateCommand(commandValue, currentIdentity) {
  const command = record(commandValue, 'command_invalid');
  if (COMMAND_FIELDS.some(key => !(key in command) || command[key] === null || command[key] === '')) {
    throw new Cafe24CategoryRequirementsError('command_identity_missing');
  }
  if (
    command.contractType !== 'work-order'
    || command.contractVersion !== '1.0.0'
    || command.capabilityVersion !== '1.0.0'
  ) {
    throw new Cafe24CategoryRequirementsError('command_contract_invalid');
  }
  const identity = record(currentIdentity, 'identity_unavailable');
  if (IDENTITY_FIELDS.some(key => command[key] !== identity[key])) {
    throw new Cafe24CategoryRequirementsError('stale_identity');
  }
  const operation = record(command.operation, 'operation_invalid');
  if (operation.capability !== CAPABILITY) {
    throw new Cafe24CategoryRequirementsError('capability_invalid');
  }
  const parameters = record(operation.parameters, 'operation_invalid');
  const mallId = text(parameters.mallId);
  const categoryNo = text(parameters.categoryNo);
  const expectedSchemaVersion = text(parameters.expectedSchemaVersion);
  if (!mallId || !categoryNo || !expectedSchemaVersion) {
    throw new Cafe24CategoryRequirementsError('parameters_invalid');
  }
  return Object.freeze({ mallId, categoryNo, expectedSchemaVersion });
}

function advertisedEndpoint(catalog, expectedSchemaVersion) {
  const samePath = list(catalog.endpoints).filter(endpointValue => {
    const endpoint = record(endpointValue, 'catalog_invalid');
    return text(endpoint.pathTemplate) === CATEGORY_PATH_TEMPLATE;
  });
  if (!samePath.length) return null;
  const endpoint = samePath.find(item => (
    text(item.method).toUpperCase() === 'GET'
    && item.authoritative === true
  ));
  if (!endpoint) throw new Cafe24CategoryRequirementsError('endpoint_unadvertised');
  if (text(endpoint.schemaVersion) !== expectedSchemaVersion) {
    throw new Cafe24CategoryRequirementsError('stale_schema');
  }
  return endpoint;
}

function classifyRequirements(provider) {
  const requiredFields = [];
  const unsupportedFields = list(provider.unsupportedFields).map(text).filter(Boolean);
  for (const requirementValue of list(provider.requirements)) {
    const requirement = record(requirementValue, 'provider_response_invalid');
    const fieldId = text(requirement.fieldId);
    const evidenceRefs = list(requirement.evidenceRefs).map(text).filter(Boolean);
    if (
      fieldId
      && requirement.required === true
      && requirement.authority === 'cafe24-category-schema'
      && evidenceRefs.length
    ) {
      requiredFields.push(Object.freeze({
        fieldId,
        required: true,
        source: 'cafe24-category-schema',
        confidence: 1,
        evidenceRefs: Object.freeze(evidenceRefs),
      }));
    } else if (fieldId) {
      unsupportedFields.push(fieldId);
    }
  }
  return {
    requiredFields: Object.freeze(requiredFields),
    unsupportedFields: Object.freeze([...new Set(unsupportedFields)]),
  };
}

export function createCafe24CategoryRequirementsCapability(options = {}) {
  const transport = callable(options.transport, 'transport');
  const catalogTransport = callable(options.catalogTransport, 'catalogTransport');
  const getCurrentIdentity = callable(options.getCurrentIdentity, 'getCurrentIdentity');
  const digest = callable(options.digest, 'digest');

  return Object.freeze({
    capability: CAPABILITY,
    async resolve(command) {
      const parameters = validateCommand(command, getCurrentIdentity());
      const catalog = record(await catalogTransport({
        method: 'POST',
        path: CATALOG_PATH,
        body: { mallId: parameters.mallId },
      }), 'catalog_invalid');
      const catalogVersion = text(catalog.catalogVersion);
      const catalogDigest = text(catalog.catalogDigest);
      if (!catalogVersion || !catalogDigest) {
        throw new Cafe24CategoryRequirementsError('catalog_invalid');
      }
      const endpoint = advertisedEndpoint(catalog, parameters.expectedSchemaVersion);
      if (!endpoint) {
        return unsupportedResult(
          parameters,
          catalog,
          [],
          Object.freeze({ endpoint: CATALOG_PATH, evidenceDigest: catalogDigest }),
        );
      }
      const path = CATEGORY_PATH_TEMPLATE.replace('{category_no}', encodeURIComponent(parameters.categoryNo));
      const provider = record(await transport({
        method: 'GET',
        path,
        mallId: parameters.mallId,
      }), 'provider_response_invalid');
      if (
        text(provider.categoryNo) !== parameters.categoryNo
        || text(provider.schemaVersion) !== parameters.expectedSchemaVersion
      ) {
        throw new Cafe24CategoryRequirementsError('stale_schema');
      }
      const classified = classifyRequirements(provider);
      const evidenceDigest = await digest(JSON.stringify(provider));
      if (provider.authoritative !== true) {
        return unsupportedResult(
          parameters,
          catalog,
          [
            ...classified.unsupportedFields,
            ...classified.requiredFields.map(field => field.fieldId),
          ],
          Object.freeze({ endpoint: path, evidenceDigest }),
        );
      }
      const status = classified.requiredFields.length
        ? classified.unsupportedFields.length ? 'partial' : 'resolved'
        : 'unsupported';
      return Object.freeze({
        status,
        mallId: parameters.mallId,
        categoryNo: parameters.categoryNo,
        schemaVersion: parameters.expectedSchemaVersion,
        catalogVersion: text(catalog.catalogVersion),
        catalogDigest: text(catalog.catalogDigest),
        requiredFields: classified.requiredFields,
        unsupportedFields: classified.unsupportedFields,
        source: Object.freeze({ endpoint: path, evidenceDigest }),
      });
    },
  });
}
