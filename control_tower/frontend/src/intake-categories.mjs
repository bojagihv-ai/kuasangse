export function normalizeCafe24Categories(rows) {
  const items = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row?.category_no || '');
    const name = String(row?.category_name || '').trim();
    if (!/^\d+$/.test(id) || !name) continue;
    const path = Object.values(row.full_category_name || {}).filter(value => typeof value === 'string' && value.trim());
    items.set(id, { id, name, label: path.join(' > ') || name });
  }
  return [...items.values()];
}

export async function loadCafe24Categories(apiHub, fetchImpl = fetch) {
  if (!apiHub) throw new Error('API Hub 연결 주소가 없습니다.');
  const items = new Map();
  for (let offset = 0; offset <= 8000; offset += 100) {
    const response = await fetchImpl(`${apiHub}/api/invoke/cafe24_control_tower/console-products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ body: { method: 'GET', path: `/api/v2/admin/categories?limit=100&offset=${offset}`, title: '생산관제 입력용 Cafe24 분류 조회' } }),
    });
    const result = await response.json();
    if (!response.ok || result.ok === false) throw new Error(`Cafe24 연결 확인 필요 (HTTP ${result.status || response.status})`);
    const rows = result.response?.body?.data?.response?.categories;
    if (!Array.isArray(rows)) throw new Error('Cafe24 분류 응답을 확인할 수 없습니다.');
    const previous = items.size;
    for (const item of normalizeCafe24Categories(rows)) items.set(item.id, item);
    if (rows.length < 100) return [...items.values()];
    if (items.size === previous) throw new Error('Cafe24 분류 목록이 반복됩니다. 다시 불러와 주세요.');
  }
  throw new Error('Cafe24 분류 조회 범위를 초과했습니다.');
}
