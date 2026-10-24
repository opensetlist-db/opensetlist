import { spawn } from 'node:child_process';
import { closeSync, openSync, writeFileSync } from 'node:fs';

const [next, port, root, log, pidFile] = process.argv.slice(2);
const output = openSync(log, 'w');
const error = openSync(`${log}.err`, 'w');
// libuv passes only the selected stdio handles. Start-Process with redirected
// output on Windows PowerShell 5.1 can leave a caller's capture pipe inherited
// by the detached server, preventing that caller from ever returning.
const child = spawn(process.execPath, [next, 'start', '-p', port], {
  cwd: root,
  env: { ...process.env, SENTRY_AUTH_TOKEN: '', SENTRY_DSN: '', NEXT_PUBLIC_SENTRY_DSN: '' },
  detached: true,
  windowsHide: true,
  stdio: ['ignore', output, error],
});
child.once('error', (failure) => { console.error(failure); process.exitCode = 1; });
child.once('spawn', () => {
  writeFileSync(pidFile, String(child.pid));
  closeSync(output);
  closeSync(error);
  child.unref();
});
