'use strict';

// 계약: **백엔드가 꺼져 있으면 그렇게 말한다.** 남의 프로그램을 탓하지 않는다.
//
// 전수 진단 #14 (medium): 상세페이지 백엔드(5050)가 꺼져 있으면 세 서비스 상태 조회가 전부
// 실패하는데, 준비 점검은 그것을 "신화사DB, Cafe24 Control Tower, VM 후보 수집기가
// 꺼져 있다" 로 읽고 사장님께 세 프로그램을 실행하겠냐고 묻는다. 승낙해도 실행 요청 역시
// 같은 백엔드로 가므로 'fetch failed' 영어 한 줄로 끝난다.
// 정작 켜야 할 것(런처)은 어디에도 나오지 않는다.
//
// 또 하나: 그 물음이 window.confirm 이다. 알림창은 앱 전체를 멈춰 세운다 —
// 2026-08-30 에 alert() 하나 때문에 "수집이 멈췄다" 고 세 번 오진한 적이 있어
// 이 파일에서 alert 는 이미 걷어냈는데 confirm 이 남아 있었다.
//
// 이 검사는 모듈을 **실제로 실행해서** 확인한다. 소스 정규식만으로는 동작을 못 지킨다.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const MODULE_URL = new URL(`file:///${path.join(ROOT, 'src/modules/local-service-preflight.mjs').replace(/\\/g, '/')}`);

function makeRuntime({ backendDown = false, running = {}, onConfirm } = {}) {
  const calls = { fetches: [], logs: [], states: [], confirms: 0 };
  const runtime = {
    state: { backendBaseUrl: 'http://127.0.0.1:5050' },
    window: {
      confirm(message) {
        calls.confirms += 1;
        return onConfirm ? onConfirm(message) : false;
      },
    },
    async fetchJsonWithTimeout(url, options) {
      calls.fetches.push({ url: String(url), method: options?.method || 'GET' });
      if (backendDown) throw new TypeError('Failed to fetch');
      const id = String(url).includes('sinhwa') ? 'sinhwa'
        : String(url).includes('cafe24') ? 'cafe24' : 'jepum';
      return { ok: true, running: running[id] !== false, port: 1234 };
    },
    factoryLog(message, level) { calls.logs.push({ message: String(message), level }); },
  };
  // 준비 상태는 런타임 훅이 아니라 factory.automation.localServicePreflight 에 직접 쓴다.
  const factory = {};
  const states = () => {
    const view = factory.automation?.localServicePreflight;
    return view ? [{ phase: view.state, message: String(view.message || '') }] : [];
  };
  return { runtime, calls, factory, states };
}

// 서명은 (factory, runtime, options) 다.
async function loadPreflight() {
  const module = await import(MODULE_URL.href);
  return module.ensureRequiredLocalServices;
}

test('백엔드가 꺼져 있으면 백엔드를 지목한다 - 남의 프로그램을 탓하지 않는다', async () => {
  const ensure = await loadPreflight();
  const { runtime, factory, states } = makeRuntime({ backendDown: true });
  const ok = await ensure(factory, runtime, { sourceMode: 'all' });

  assert.equal(ok, false, '백엔드가 없으면 준비됐다고 하면 안 됩니다.');
  const failed = states().filter(item => item.phase === 'failed').map(item => item.message).join('\n');
  assert.match(failed, /백엔드/, `무엇이 꺼졌는지 말하지 않았습니다: ${failed}`);
  assert.match(failed, /런처|launcher/, `무엇을 하면 되는지 없으면 안내가 아닙니다: ${failed}`);
  // 세 서비스 이름이 문장에 나오는 것 자체는 좋다 - "그 셋이 꺼진 것이 **아니라**" 고
  // 짚어 주는 것이 오해를 막는다. 막아야 하는 것은 그 셋을 탓하는 옛 문구다.
  assert.match(failed, /꺼진 것이 아니라/,
    '세 프로그램이 아니라는 것을 분명히 말해야 사장님이 엉뚱한 것을 켜지 않습니다.');
  assert.doesNotMatch(failed, /의 응답이 없습니다/,
    '백엔드 하나가 꺼진 것을 세 프로그램 탓으로 돌리면 안 됩니다.');
  assert.doesNotMatch(failed, /Failed to fetch/, '영어 원문을 그대로 보여주면 사장님은 읽을 수 없습니다.');
});

test('백엔드가 꺼져 있으면 실행하겠냐고 묻지 않는다', async () => {
  const ensure = await loadPreflight();
  const { runtime, calls, factory } = makeRuntime({ backendDown: true });
  await ensure(factory, runtime, { sourceMode: 'all' });
  assert.equal(calls.confirms, 0,
    '켤 수 없는 것을 켜겠냐고 물으면 사장님은 승낙하고 또 실패를 봅니다.');
});

test('서비스 상태를 묻기 전에 백엔드부터 확인한다', async () => {
  const ensure = await loadPreflight();
  const { runtime, calls, factory } = makeRuntime({ backendDown: true });
  await ensure(factory, runtime, { sourceMode: 'all' });
  assert.ok(calls.fetches.length >= 1, '아무것도 묻지 않았습니다.');
  // 백엔드가 죽었으면 세 서비스에 각각 물어볼 필요가 없다 - 첫 확인에서 끝난다.
  const serviceProbes = calls.fetches.filter(item => /sinhwa-db\/status|cafe24-control\/status|jepum-scraper\/status/.test(item.url));
  assert.ok(serviceProbes.length <= 1,
    `백엔드가 죽었는데 서비스 상태를 ${serviceProbes.length}번 물었습니다.`);
});

test('백엔드가 살아 있고 서비스도 살아 있으면 예전처럼 준비 완료다', async () => {
  const ensure = await loadPreflight();
  const { runtime, calls, factory, states } = makeRuntime({});
  const ok = await ensure(factory, runtime, { sourceMode: 'all' });
  assert.equal(ok, true, `준비된 상태를 막으면 안 됩니다: ${JSON.stringify(states())}`);
  assert.equal(calls.confirms, 0);
});

test('백엔드는 살아 있고 서비스만 꺼져 있으면 예전처럼 그 서비스를 지목한다', async () => {
  const ensure = await loadPreflight();
  const { runtime, factory, states } = makeRuntime({ running: { sinhwa: false }, onConfirm: () => false });
  const ok = await ensure(factory, runtime, { sourceMode: 'all' });
  assert.equal(ok, false);
  const said = states().map(item => item.message).join('\n');
  assert.match(said, /신화사DB/, `꺼진 서비스를 지목하지 않았습니다: ${said}`);
});
