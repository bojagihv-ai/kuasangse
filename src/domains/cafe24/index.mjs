import { normalizeCafe24ProductFields } from './fields.mjs';
import { buildCafe24OptionModel } from './options.mjs';
import { buildCafe24ProductPayload, createCafe24PayloadGuard } from './payload.mjs';
import { createCafe24ApiClient } from './api.mjs';
import { createCafe24SyncService } from './sync.mjs';
import { buildCafe24PublishPreview } from './ui.mjs';

export function createCafe24Domain(options = {}) {
  const payloadGuard = createCafe24PayloadGuard();
  const api = typeof options.transport === 'function'
    ? createCafe24ApiClient({ transport: options.transport, payloadGuard })
    : null;
  const sync = api && typeof options.getOperationToken === 'function'
    ? createCafe24SyncService({ client: api, getOperationToken: options.getOperationToken })
    : null;
  return Object.freeze({
    fields: Object.freeze({ normalize: normalizeCafe24ProductFields }),
    options: Object.freeze({ buildModel: buildCafe24OptionModel }),
    payload: Object.freeze({ buildProduct: buildCafe24ProductPayload }),
    payloadGuard,
    api,
    sync,
    ui: Object.freeze({ buildPublishPreview: buildCafe24PublishPreview }),
  });
}
