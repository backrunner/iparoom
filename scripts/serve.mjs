import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createServer } from 'node:https';
import { listenAddress, lanOrigin, shareHostname, lanAddress } from './network.mjs';
import { tlsOptions, startCertificateServer } from '../packages/cli/lib/certificates.mjs';
import { detectPonte } from '../packages/cli/lib/ponte.mjs';
import { loadUserConfig, configurationEnvironment } from '../packages/cli/lib/config.mjs';
let caServer, server, child;
let stopped = false;
const cleanup = async () => {
  if (stopped) return;
  stopped = true;
  child?.kill('SIGTERM');
  await caServer?.close();
  if (server?.listening)
    await new Promise((done) => {
      server.close(done);
      server.closeAllConnections();
    });
  process.emit('iparoom:shutdown');
};
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () =>
    cleanup().catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    })
  );
try {
  const { config, paths } = loadUserConfig({ legacyEnvFile: resolve('.env') });
  const dev = process.argv.includes('--dev');
  // Environment values are explicit runtime overrides; YAML remains the persisted source.
  for (const [key, value] of Object.entries(configurationEnvironment(config, paths))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  const interfaces = networkInterfaces();
  const host = listenAddress(interfaces, process.env.IPAROOM_LAN_HOST || undefined);
  const port = Number(process.env.PORT || (dev ? config.server.devPort : config.server.port));
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT must be between 1 and 65535.');
  const configured = process.env.IPAROOM_BASE_URL || process.env.IPAROOM_PUBLIC_URL;
  const http = process.env.IPAROOM_HTTPS === '0' || Boolean(configured?.startsWith('http://'));
  const ponte = await detectPonte({ ponte: process.env.IPAROOM_PONTE !== '0' });
  const advertised = shareHostname(
    interfaces,
    host,
    configured
      ? new URL(configured).hostname
      : process.env.IPAROOM_HOSTNAME || (!http && ponte.hostname)
  );
  const origin = lanOrigin(
    configured || `${http ? 'http' : 'https'}://${advertised}:${port}`,
    host,
    port,
    advertised
  );
  const tls = await tlsOptions(
    {
      http,
      cert: http ? undefined : process.env.IPAROOM_TLS_CERT,
      key: http ? undefined : process.env.IPAROOM_TLS_KEY,
      ca: http ? undefined : process.env.IPAROOM_CA_CERT
    },
    advertised,
    [lanAddress(interfaces), ponte.hostname]
  );
  const maxBytes = Number(process.env.IPAROOM_MAX_UPLOAD_BYTES || 1073741824);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new Error('Invalid IPAROOM_MAX_UPLOAD_BYTES.');
  const caPort = Number(process.env.IPAROOM_CA_PORT || 0);
  if (!Number.isInteger(caPort) || caPort < 0 || caPort > 65535)
    throw new Error('IPAROOM_CA_PORT must be between 0 and 65535.');
  if (stopped) throw new Error('Startup interrupted.');
  caServer = await startCertificateServer(tls, { host, hostname: advertised, port: caPort });
  if (stopped) {
    await caServer?.close();
    throw new Error('Startup interrupted.');
  }
  Object.assign(process.env, {
    BODY_SIZE_LIMIT: process.env.BODY_SIZE_LIMIT || String(maxBytes),
    HOST: host,
    PORT: String(port),
    ORIGIN: origin,
    IPAROOM_BASE_URL: origin,
    IPAROOM_HOSTNAME: advertised,
    IPAROOM_CA_CERT: tls?.rootPath || '',
    IPAROOM_CA_INSTALL_URL: caServer?.url || '',
    IPAROOM_TLS_CERT: tls?.certPath || '',
    IPAROOM_TLS_KEY: tls?.keyPath || ''
  });
  console.log(
    `Configuration: ${paths.config}\nIPA Room LAN address: ${origin}\nListening on ${host}:${port}`
  );
  if (caServer) console.log(`Install CA: ${caServer.url}\nCA SHA-256: ${caServer.fingerprint}`);
  if (!dev && tls) {
    const { handler } = await import('../build/handler.js');
    if (stopped) {
      await caServer?.close();
      throw new Error('Startup interrupted.');
    }
    server = createServer(tls, handler);
    await new Promise((done, reject) => {
      server.once('error', reject);
      server.listen(port, host, done);
    });
  } else {
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
    child = spawn(process.execPath, args, { env: process.env, stdio: 'inherit' });
    child.on('error', (error) => {
      console.error(error.message);
      process.exitCode = 1;
      cleanup();
    });
    child.on('exit', (code, signal) => {
      process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 0 : 1);
      cleanup();
    });
  }
} catch (error) {
  console.error(`iparoom: ${error.message}`);
  process.exitCode = 1;
  await cleanup();
}
