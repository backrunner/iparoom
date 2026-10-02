import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import {
  loadUserConfig,
  effectiveEnvironment,
  configurationPath
} from '../packages/cli/lib/config.mjs';
import { listenAddress, shareHostname } from './network.mjs';
import { detectPonte } from '../packages/cli/lib/ponte.mjs';
try {
  const { config, paths } = loadUserConfig({ legacyEnvFile: resolve('.env') });
  const env = effectiveEnvironment();
  const https = env.IPAROOM_HTTPS !== '0';
  if (https && (env.IPAROOM_TLS_CERT || env.IPAROOM_TLS_KEY))
    throw new Error(
      'The Docker overlay uses Caddy internal TLS. Use pnpm start for a supplied certificate chain.'
    );
  const interfaces = networkInterfaces();
  const host = listenAddress(interfaces, env.IPAROOM_LAN_HOST || undefined);
  const ponte = await detectPonte({
    ponte: env.IPAROOM_PONTE !== '0',
    ponteHostname: env.IPAROOM_PONTE_HOSTNAME || undefined
  });
  const hostname = shareHostname(
    interfaces,
    host,
    (env.IPAROOM_BASE_URL && new URL(env.IPAROOM_BASE_URL).hostname) ||
      env.IPAROOM_HOSTNAME ||
      (https && ponte.hostname)
  );
  const port = Number(process.env.PORT || config.server.port);
  const caPort = Number(env.IPAROOM_CA_PORT) || 8080;
  for (const value of [port, caPort])
    if (!Number.isInteger(value) || value < 1 || value > 65535)
      throw new Error('Docker ports must be between 1 and 65535.');
  if (https && port === caPort)
    throw new Error('Docker HTTPS and CA ports must differ. Set https.caPort in config.yaml.');
  const origin = env.IPAROOM_BASE_URL || `${https ? 'https' : 'http'}://${hostname}:${port}`;
  const url = new URL(origin);
  if (
    url.protocol !== `${https ? 'https' : 'http'}:` ||
    url.hostname !== hostname ||
    Number(url.port || (https ? 443 : 80)) !== port
  )
    throw new Error(
      'server.baseUrl must match server.hostname, server.port and https.enabled for Docker.'
    );
  const data = configurationPath(env.IPAROOM_DATA_DIR, paths.root);
  for (const dir of [
    data,
    join(paths.root, 'docker/app'),
    join(paths.root, 'caddy/data'),
    join(paths.root, 'caddy/config')
  ])
    await mkdir(dir, { recursive: true, mode: 0o700 });
  const overrides = {
    ...process.env,
    IPAROOM_COMPOSE_HOST: host,
    IPAROOM_COMPOSE_HOSTNAME: hostname,
    IPAROOM_COMPOSE_PORT: String(port),
    IPAROOM_COMPOSE_CA_PORT: String(caPort),
    IPAROOM_COMPOSE_ORIGIN: origin,
    IPAROOM_COMPOSE_CONFIG: paths.config,
    IPAROOM_COMPOSE_DATA: data,
    IPAROOM_COMPOSE_ROOT: paths.root,
    IPAROOM_COMPOSE_UID: String(process.getuid?.() ?? 1000),
    IPAROOM_COMPOSE_GID: String(process.getgid?.() ?? 1000),
    IPAROOM_COMPOSE_BODY_LIMIT: env.BODY_SIZE_LIMIT || env.IPAROOM_MAX_UPLOAD_BYTES
  };
  const command = process.env.IPAROOM_DOCKER_COMMAND || 'docker';
  const composeArgs = process.argv.slice(2);
  // Atomic editor/CLI saves replace the YAML inode. Rebind the canonical file on each up.
  if (
    composeArgs[0] === 'up' &&
    !composeArgs.includes('--force-recreate') &&
    !composeArgs.includes('--no-recreate')
  )
    composeArgs.push('--force-recreate');
  const args = [
    ...(command === 'docker' ? ['compose'] : []),
    '--project-directory',
    resolve('.'),
    '-f',
    resolve('compose.yaml'),
    ...(https ? ['-f', resolve('compose.https.yaml')] : []),
    ...composeArgs
  ];
  const child = spawn(command, args, { env: overrides, stdio: 'inherit' });
  child.on('error', (error) => {
    console.error(`Docker: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
} catch (error) {
  console.error(`iparoom: ${error.message}`);
  process.exitCode = 1;
}
