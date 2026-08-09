const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');

function moduleUrl(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  return `${pathToFileURL(absolutePath).href}?test=${Date.now()}-${Math.random()}`;
}

function reportPayload() {
  return {
    ok: true,
    count: 2,
    registeredCount: 1,
    inProgressCount: 1,
    outputDir: 'C:\\Users\\kua\\Documents\\상세페이지 작업 리포트',
    generatedAt: '2026-07-26T15:00:00+09:00',
    reports: [
      {
        workfile_name: '카페24일단 옵션빼곤성공 모시바둑파우치 복사본.kuasangse',
        project_name: '모시바둑파우치',
        product_name: '모시바둑파우치',
        exported_at: 1785070000000,
        status_code: 'cafe24_registered',
        status_label: 'Cafe24 등록 완료',
        last_completed_stage_number: 7,
        last_completed_stage_label: '전송',
        stopped_at_stage_number: 7,
        stopped_at_stage_label: '전송',
        section_count: 15,
        cafe24: {
          product_no: '2996',
          product_code: 'P0000ELG',
          product_name: '모시바둑파우치찐',
          source_workfile_name: '카페24일단 옵션빼곤성공 모시바둑파우치 복사본.kuasangse',
          continuation_workfile_names: ['카페24옵션복구 모시바둑파우치.kuasangse'],
          option_group_count: 1,
          option_value_count: 14,
          variant_count: 14,
          display: 'F',
          selling: 'F',
          admin_url: 'https://bojagi1928.cafe24.com/disp/admin/shop1/product/ProductRegister?product_no=2996',
          storefront_url: 'https://bojagi1928.cafe24.com/product/detail.html?product_no=2996',
        },
      },
      {
        workfile_name: '부분작업.kuasangse',
        project_name: '부분작업',
        product_name: '부분작업',
        exported_at: 1785060000000,
        status_code: 'factory_in_progress',
        status_label: '조립공장 진행 중',
        last_completed_stage_number: 2,
        last_completed_stage_label: 'DB 확정',
        stopped_at_stage_number: 3,
        stopped_at_stage_label: '필수값',
        section_count: 0,
        cafe24: null,
      },
    ],
  };
}

test('MENU-REPORTS: 작업파일 단계와 Cafe24 등록 근거를 한 화면에 렌더한다', async () => {
  const { createReportsMenu } = await import(moduleUrl('src/menus/reports-menu.mjs'));
  const calls = { fetch: 0, open: 0, render: 0 };
  const menu = createReportsMenu({
    fetchReports: async () => {
      calls.fetch += 1;
      return reportPayload();
    },
    openReportFolder: async () => {
      calls.open += 1;
      return { ok: true };
    },
    requestRender() {
      calls.render += 1;
    },
    escapeHtml(value) {
      return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;');
    },
    escapeAttr(value) {
      return String(value ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;');
    },
  });

  assert.equal(menu.id, 'reports');
  assert.deepEqual(menu.routes, ['reports']);
  assert.deepEqual(menu.persistence, { reads: [], writes: [] });

  await menu.invoke('refresh');
  const html = menu.render(menu.select({}));

  assert.equal(calls.fetch, 1);
  assert.match(html, /작업 리포트/);
  assert.match(html, /#2996/);
  assert.match(html, /1그룹 · 14값 · 14품목/);
  assert.match(html, /진열 F · 판매 F/);
  assert.match(html, /3단계 필수값/);
  assert.match(html, /카페24일단 옵션빼곤성공 모시바둑파우치 복사본\.kuasangse/);
  assert.match(html, /카페24옵션복구 모시바둑파우치\.kuasangse/);
  assert.match(html, /Cafe24 관리자/);
  assert.match(html, /상품 페이지/);

  await menu.invoke('openFolder');
  assert.equal(calls.open, 1);
});

test('MENU-REPORTS: 조회 실패를 전역 오류 대신 메뉴 안에서 복구 가능하게 표시한다', async () => {
  const { createReportsMenu } = await import(moduleUrl('src/menus/reports-menu.mjs'));
  const menu = createReportsMenu({
    fetchReports: async () => {
      throw new Error('report backend unavailable');
    },
    openReportFolder: async () => ({ ok: true }),
    requestRender() {},
    escapeHtml: value => String(value ?? ''),
    escapeAttr: value => String(value ?? ''),
  });

  await assert.rejects(menu.invoke('refresh'), /report backend unavailable/);
  const html = menu.render(menu.select({}));

  assert.match(html, /리포트를 불러오지 못했습니다/);
  assert.match(html, /report backend unavailable/);
  assert.match(html, /다시 불러오기/);
});

test('MENU-REPORTS: 메뉴 진입 시 이전 화면의 내부 스크롤을 초기화한다', async () => {
  const { createReportsMenu } = await import(moduleUrl('src/menus/reports-menu.mjs'));
  let resetCount = 0;
  const menu = createReportsMenu({
    fetchReports: async () => ({ ok: true, reports: [] }),
    openReportFolder: async () => ({ ok: true }),
    requestRender() {},
    escapeHtml: value => String(value ?? ''),
    escapeAttr: value => String(value ?? ''),
    resetScroll() {
      resetCount += 1;
    },
  });

  menu.onEnter();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(resetCount, 2);
});
