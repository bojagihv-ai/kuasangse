import { classifyKuasangseWorkfile } from './workfile-intake-model.mjs';

self.addEventListener('message', async event => {
  const file = event.data?.file;
  if (!(file instanceof Blob)) {
    self.postMessage({ type: 'error', code: 'workfile_required' });
    return;
  }
  try {
    self.postMessage({ type: 'progress', phase: 'reading' });
    const source = await file.text();
    self.postMessage({ type: 'progress', phase: 'parsing' });
    const value = JSON.parse(source);
    const result = classifyKuasangseWorkfile(value);
    self.postMessage({ type: 'complete', result });
  } catch (error) {
    self.postMessage({
      type: 'error',
      code: String(error?.code || (error instanceof SyntaxError ? 'workfile_json_invalid' : 'workfile_read_failed')),
    });
  }
});
