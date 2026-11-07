import { spawn } from 'node:child_process';
import electron from 'electron';
import { createServer } from 'vite';

const server = await createServer();
await server.listen();
const child = spawn(electron, ['.', '--dev'], { stdio: 'inherit' });
let stopping = false;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  child.kill();
  await server.close();
  process.exit(code);
}
child.on('error', () => { console.error('Could not launch Electron.'); void stop(1); });
child.on('exit', code => { void stop(code ?? 1); });
process.on('SIGINT', () => { void stop(0); });
process.on('SIGTERM', () => { void stop(0); });
