const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', 'app-core-01.js'), 'utf8');
const start = source.indexOf('class ApiHubOpenAIImageAPI');
const end = source.indexOf('// OPENAI API SERVICE', start);

test('API Hub OpenAI 이미지 경로는 참고 이미지와 이미지 생성 도구를 Responses API로 전달한다', async () => {
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  let request = null;
  const context = vm.createContext({
    getEffectiveImageDirectives: () => [],
    buildBrandPromptBlock: () => 'brand',
    buildLayoutPromptBlock: () => 'layout',
    normalizeImagePayloadForApi: (base64, mime) => ({ base64, mime }),
    getRequestedImageSize: () => '1024x1024',
    fetch: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({
          ok: true,
          response: { body: { output: [{ type: 'image_generation_call', result: 'aGVsbG8=' }] } },
        }),
      };
    },
    tokenTracker: { record() {} },
    applyImageSizeConfig: async value => value,
  });
  vm.runInContext(`${source.slice(start, end)};globalThis.ImageClient = ApiHubOpenAIImageAPI;`, context);

  const result = await new context.ImageClient().generateImage(
    '제품 정체성을 유지한다.',
    'cHJpbWFyeQ==',
    'image/png',
    'api-hub-openai-image',
    [{ base64: 'ZXh0cmE=', mime: 'image/jpeg' }],
  );
  const body = JSON.parse(request.options.body);

  assert.equal(request.url, 'http://127.0.0.1:4321/api/invoke/openai_chatgpt/responses');
  assert.equal(body.body.model, 'gpt-5.6');
  assert.equal(body.body.tools[0].type, 'image_generation');
  assert.deepEqual(body.body.input[0].content.map(item => item.type), ['input_text', 'input_image', 'input_image']);
  assert.equal(result, 'data:image/png;base64,aGVsbG8=');

  context.fetch = async () => ({
    ok: false,
    json: async () => ({ ok: false, error: 'This operation was aborted' }),
  });
  await assert.rejects(
    () => new context.ImageClient().generateImage('재시도', '', 'image/png'),
    /This operation was aborted/,
  );
});
