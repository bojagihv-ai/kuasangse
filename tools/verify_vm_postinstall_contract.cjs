const fs = require('fs');
const path = require('path');

const root = process.cwd();
const generatorPath = path.join(root, 'tools', 'prepare_vm_worker_postinstall.ps1');
const generatedPath = path.join(root, 'output', 'vm-rebuild', 'win_vm_worker_postinstall-rev3.cmd');
const legacySpecializePath = path.join(root, 'tools', 'prepare_vm_worker_unattend.ps1');
const generator = fs.existsSync(generatorPath) ? fs.readFileSync(generatorPath, 'utf8') : '';
const generated = fs.existsSync(generatedPath) ? fs.readFileSync(generatedPath, 'utf8') : '';
const legacySpecialize = fs.readFileSync(legacySpecializePath, 'utf8');

const additionsMarker = '@@VBOX_COND_IS_INSTALLING_ADDITIONS@@';
const seedTaskName = 'JepumScraper VM Worker Bootstrap Seed';
const seedIndex = generated.indexOf(seedTaskName);
const additionsIndex = generated.indexOf(additionsMarker);

const checks = {
  generatorExists: Boolean(generator),
  generatorSeedsBeforeGuestAdditions: generator.indexOf(seedTaskName) >= 0
    && generator.indexOf(additionsMarker) >= 0
    && /\$template\.Insert\(\$markerIndex,\s*\$seedTask\)/.test(generator),
  generatedSeedsBeforeGuestAdditions: Boolean(generated)
    && seedIndex >= 0
    && additionsIndex >= 0
    && seedIndex < additionsIndex,
  generatedUsesSystemStartupTask: /schtasks\.exe\s+\/create/i.test(generated)
    && /\/sc\s+onstart/i.test(generated)
    && /\/ru\s+SYSTEM/i.test(generated)
    && /-EncodedCommand/i.test(generated),
  legacySpecializeDoesNotInstallGuestAdditions: !/VBoxWindowsAdditions\.exe/i.test(legacySpecialize),
};

const failures = Object.entries(checks)
  .filter(([, ok]) => !ok)
  .map(([name]) => name);

console.log(JSON.stringify({ ok: failures.length === 0, checks, failures }, null, 2));
if (failures.length) process.exit(1);
