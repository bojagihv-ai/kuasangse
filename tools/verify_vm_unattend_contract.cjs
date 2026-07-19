const fs = require('fs');
const path = require('path');

const root = process.cwd();
const sourcePath = path.join(root, 'tools', 'prepare_vm_worker_unattend.ps1');
const generatedPath = path.resolve(
  root,
  process.argv[2] ?? path.join('output', 'vm-rebuild', 'win11_vm_worker_unattend-rev2.xml'),
);
const source = fs.readFileSync(sourcePath, 'utf8');
const generated = fs.existsSync(generatedPath) ? fs.readFileSync(generatedPath, 'utf8') : '';
const encodedCommand = generated.match(/-EncodedCommand\s+([A-Za-z0-9+/=]+)/i)?.[1] ?? '';
const generatedBootstrap = encodedCommand
  ? Buffer.from(encodedCommand, 'base64').toString('utf16le')
  : '';

const checks = {
  hasSystemStartupTask: /New-ScheduledTaskTrigger\s+-AtStartup/.test(source)
    && /New-ScheduledTaskPrincipal\s+-UserId\s+'SYSTEM'/.test(source)
    && /Register-ScheduledTask\s+-TaskName\s+'JepumScraper VM Worker Bootstrap'/.test(source),
  sourceDoesNotForceReboot: !/shutdown\.exe\s+\/r/i.test(source),
  generatedTemplateDoesNotForceReboot: generated
    ? !/shutdown\.exe\s+\/r/i.test(generatedBootstrap)
    : true,
  generatedTemplateHasSystemStartupTask: generated
    ? /New-ScheduledTaskTrigger\s+-AtStartup/.test(generatedBootstrap)
      && /New-ScheduledTaskPrincipal\s+-UserId\s+'SYSTEM'/.test(generatedBootstrap)
      && /Register-ScheduledTask\s+-TaskName\s+'JepumScraper VM Worker Bootstrap'/.test(generatedBootstrap)
    : true,
};

const failures = Object.entries(checks)
  .filter(([, ok]) => !ok)
  .map(([name]) => name);

console.log(JSON.stringify({ ok: failures.length === 0, checks, failures }, null, 2));
if (failures.length) process.exit(1);
