'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const FRONTEND = path.resolve(__dirname, '../../frontend');
const HTML = fs.readFileSync(path.join(FRONTEND, 'control-tower.html'), 'utf8');
const SOURCE = fs.readFileSync(path.join(FRONTEND, 'src', 'production-workbench.mjs'), 'utf8');
const MODULE = pathToFileURL(path.join(FRONTEND, 'src', 'production-workbench.mjs')).href;

/**
 * 실측 2026-09-16 (실서버 42011): 작업 큐 15건 중 3건만 보이는데 눌린 버튼은 "전체" 였고,
 * 숨은 11건은 전부 status=blocked 였다. 같은 순간 개요 "내 차례" 는 그 11건을 "손댈 일"
 * 1순위("막힌 작업 되살리기")로 세우고 있었다. 한 화면이 1순위라 부르는 것을 다른 화면이
 * "이전 차단 기록" 으로 숨기면, 조작자는 큐에서 그 작업을 찾지 못한다.
 *
 * 접어 두는 동작 자체는 쓸모가 있다. 이름을 ‘실행 대상’ 으로 옮기고 ‘전체’ 는 전체를 보인다.
 */

test('전체와 실행 대상은 둘 다 모든 작업을 그린다 — 접기는 그 다음 문제다', async () => {
  const { queueFilterMatches } = await import(MODULE);
  const jobs = [
    { status: 'blocked' }, { status: 'completed' }, { status: 'running' },
    { status: 'queued' }, { status: 'waiting_manual' },
  ];
  for (const job of jobs) {
    assert.equal(queueFilterMatches(job, 'all'), true, `전체가 ${job.status} 를 걸렀다`);
    assert.equal(queueFilterMatches(job, 'actionable'), true, `실행 대상이 ${job.status} 를 걸렀다`);
  }
});

test('상태 필터는 그 상태만 남긴다', async () => {
  const { queueFilterMatches } = await import(MODULE);
  assert.equal(queueFilterMatches({ status: 'blocked' }, 'blocked'), true);
  assert.equal(queueFilterMatches({ status: 'blocked' }, 'completed'), false);
  assert.equal(queueFilterMatches({ status: 'completed' }, 'completed'), true);
});

test('접기는 ‘실행 대상’ 에서만 일어난다 — ‘전체’ 에서 숨기면 이름이 거짓말이 된다', () => {
  const rule = HTML.match(/\.operator-queue-list\[data-queue-view-filter="([a-z]+)"\]\s*\.operator-job-row\[data-historical="true"\]\s*\{[^}]*display:\s*none/u);
  assert.ok(rule, '이전 기록을 접는 CSS 규칙을 찾지 못했다');
  assert.equal(rule[1], 'actionable');
  assert.doesNotMatch(
    HTML,
    /\.operator-queue-list\[data-queue-view-filter="all"\]\s*\.operator-job-row\[data-historical="true"\]\s*\{[^}]*display:\s*none/u,
    '‘전체’ 에서 행을 숨기는 규칙이 되살아났다',
  );
});

test('기본값은 실행 대상이고, 전체 버튼이 함께 있다', () => {
  assert.match(SOURCE, /let queueFilter = 'actionable';/u);
  assert.match(HTML, /data-queue-filter="actionable" aria-pressed="true">실행 대상</u);
  assert.match(HTML, /data-queue-filter="all" aria-pressed="false">전체</u);
});

test('접었을 때는 어디서 볼 수 있는지 ‘전체’ 를 가리킨다', () => {
  const hint = SOURCE.slice(SOURCE.indexOf("queueFilter === 'actionable' && hiddenHistoryCount"));
  assert.match(hint.slice(0, 900), /‘전체’ 에서 볼 수 있습니다/u);
  assert.doesNotMatch(hint.slice(0, 900), /이전 차단 기록/u, '막힌 작업을 "이전 기록" 이라 부르지 않는다');
});
