import { spawn } from 'node:child_process';
import { createServer as createViteServer } from 'vite';

const backend = spawn(
  process.execPath,
  ['--env-file-if-exists=.env', 'server/index.js'],
  { stdio: 'inherit' },
);
backend.on('exit', (code) => {
  if (!stopping) process.exit(code || 1);
});

let stopping = false;
const vite = await createViteServer({
  configFile: 'vite.config.js',
  server: { host: '0.0.0.0', port: 5173, strictPort: true },
});

try {
  await vite.listen();
  vite.printUrls();
} catch (error) {
  stopping = true;
  backend.kill();
  throw error;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    await vite.close();
    backend.kill();
    process.exit(0);
  });
}
