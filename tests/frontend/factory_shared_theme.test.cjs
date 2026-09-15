const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname, '../..');

test('original factory and bulk control share the same base theme rather than drifting copies', () => {
  const original = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
  const control = fs.readFileSync(path.join(root, 'control_tower/frontend/control-tower.html'), 'utf8');
  assert.match(original, /href="src\/factory-theme\.css/);
  assert.match(control, /href="\/factory-native\/src\/factory-theme\.css/);
  const theme = fs.readFileSync(path.join(root, 'src/factory-theme.css'), 'utf8');
  for (const [key, value] of Object.entries({ primary: '#6366f1', bg: '#0f0f13', text: '#e4e4e7', 'text-d': '#9494a5', 'space-2': '8px', 'space-4': '16px' })) {
    assert.match(theme, new RegExp(`--${key}:\\s*${value}`));
    assert.doesNotMatch(original, new RegExp(`--${key}:`));
    assert.doesNotMatch(control, new RegExp(`--${key}:`));
  }
  assert.match(control, /pretendard\/dist\/web\/static\/pretendard\.css/);
});
