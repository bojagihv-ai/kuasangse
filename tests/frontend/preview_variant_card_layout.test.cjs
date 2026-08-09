const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../..');
const APP_HTML = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');

test('preview quick comparison cards constrain long candidate metadata inside the card', () => {
  assert.match(APP_HTML, /\.variant-quickchip\{[^}]*min-width:0[^}]*overflow:hidden/);
  assert.match(APP_HTML, /\.variant-quickcopy\{[^}]*min-width:0[^}]*flex:1[^}]*overflow:hidden/);
  assert.match(APP_HTML, /\.variant-quickname\{[^}]*display:block[^}]*max-width:100%[^}]*white-space:nowrap[^}]*overflow:hidden/);
  assert.match(APP_HTML, /\.variant-quickmeta\{[^}]*display:block[^}]*max-width:100%[^}]*white-space:nowrap[^}]*overflow:hidden/);
});
