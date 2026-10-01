import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { lanAddress, lanOrigin } from './network.mjs';
try {
  try {
    process.loadEnvFile('.env');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const dev = process.argv.includes('--dev');
  const host = lanAddress(networkInterfaces(), process.env.IPAROOM_LAN_HOST);
  const port = Number(process.env.PORT || (dev ? 5173 : 3000));
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT must be between 1 and 65535.');
  const origin = lanOrigin(
    process.env.IPAROOM_BASE_URL || process.env.IPAROOM_PUBLIC_URL,
    host,
    port
  );
  const maxBytes = Number(process.env.IPAROOM_MAX_UPLOAD_BYTES || 1073741824);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new Error('Invalid IPAROOM_MAX_UPLOAD_BYTES.');
  const env = {
    ...process.env,
    BODY_SIZE_LIMIT: process.env.BODY_SIZE_LIMIT || String(maxBytes),
    HOST: host,
    PORT: String(port),
    ORIGIN: origin,
    IPAROOM_BASE_URL: origin
  };
  const args = dev
    ? [
        resolve('node_modules/vite/bin/vite.js'),
        'dev',
        '--host',
        host,
        '--port',
        String(port),
        '--strictPort'
      ]
    : [resolve('build/index.js')];
  console.log(`IPA Room LAN address: ${origin}`);
  console.log(
    `Listening on ${host}:${port}${host === '127.0.0.1' ? ' (no LAN interface found; local access only)' : ''}`
  );
  const child = spawn(process.execPath, args, { env, stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
  });
} catch (error) {
  console.error(`iparoom: ${error.message}`);
  process.exitCode = 1;
}
