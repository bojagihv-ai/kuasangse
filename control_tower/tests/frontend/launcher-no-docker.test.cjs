const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('신화사 실행에 빈 SQL 설정을 전달하여 Docker를 시작하지 않는다', { skip: process.platform !== 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-launch-sql-'));
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  try {
    const receipt = path.join(dir, 'receipt.json');
    const manager = path.join(dir, 'manager.ps1');
    fs.writeFileSync(manager, `param($Action, $BackendPort, $FrontendPort, [string]$SqlContainerName='default')\nif ($Action -eq 'Start') { @{sql=$SqlContainerName; backend=$BackendPort; frontend=$FrontendPort} | ConvertTo-Json -Compress | Set-Content -Encoding UTF8 ${quote(receipt)} }`);
    const launcher = path.resolve(__dirname, '../../launch.ps1');
    const script = `
$ast=[System.Management.Automation.Language.Parser]::ParseFile(${quote(launcher)},[ref]$null,[ref]$null)
$body=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Ensure-SinhwaHubReady'},$true)
Invoke-Expression $body.Extent.Text
$DefaultPdpControlBaseUrl='control'; $DefaultPdpAssetsBaseUrl='assets'; $PdpControlBaseUrl=''; $PdpAssetsBaseUrl=''
$SinhwaHubManagerPath=${quote(manager)}
function Test-SinhwaHubReady { Test-Path -LiteralPath ${quote(receipt)} }
Ensure-SinhwaHubReady
Get-Content -LiteralPath ${quote(receipt)} -Raw
`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 20000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const saved = JSON.parse(result.stdout.trim().replace(/^\uFEFF/, ''));
    assert.equal(saved.sql, '');
    assert.equal(String(saved.backend), '8200');
    assert.equal(String(saved.frontend), '5173');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
