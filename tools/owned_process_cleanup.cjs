const { execFile } = require('node:child_process');

function waitForExit(child) {
  return new Promise(resolve => {
    const finish = () => {
      clearTimeout(timer);
      child.removeListener('exit', finish);
      resolve();
    };
    const timer = setTimeout(finish, 3000);
    child.once('exit', finish);
    if (child.exitCode !== null || child.signalCode !== null) finish();
  });
}

async function terminateOwnedProcessTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = waitForExit(child);
  if (process.platform === 'win32' && child.pid) {
    await new Promise(resolve => {
      execFile(
        'taskkill.exe',
        ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, timeout: 3000 },
        resolve,
      );
    });
  } else {
    try { child.kill('SIGKILL'); } catch (_) {}
  }
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill('SIGKILL'); } catch (_) {}
  }
  await exited;
}

module.exports = { terminateOwnedProcessTree };
