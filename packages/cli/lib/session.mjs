import { networkInterfaces, tmpdir } from 'node:os';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createReadStream } from 'node:fs';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { listenAddress, shareHostname, lanAddress } from './network.mjs';
import { tlsOptions, startCertificateServer } from './certificates.mjs';
import { detectPonte } from './ponte.mjs';
import { shareOptions, effectiveEnvironment } from './config.mjs';
export { tlsOptions } from './certificates.mjs';

export async function ipaFile(input) {
  const path = resolve(input);
  const info = await stat(path);
  if (info.isDirectory()) {
    const matches = (await readdir(path)).filter((name) => name.toLowerCase().endsWith('.ipa'));
    if (matches.length !== 1)
      throw new Error('Export directory must contain exactly one IPA. Pass an explicit .ipa path.');
    return ipaFile(join(path, matches[0]));
  }
  if (!info.isFile() || !path.toLowerCase().endsWith('.ipa'))
    throw new Error('Pass a valid .ipa file or export directory.');
  return { path, size: info.size };
}
export function portNumber(value, label = '--port') {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error(`${label} must be an integer between 0 and 65535.`);
  return port;
}
export async function createShareSession(options = {}) {
  options = shareOptions(options);
  const configuredEnv = effectiveEnvironment();
  const runtime = fileURLToPath(new URL('../runtime/web/handler.js', import.meta.url));
  try {
    await stat(runtime);
  } catch {
    throw new Error(
      'Bundled web server is missing. From source run pnpm build:cli, or install the packaged iparoom-cli tarball.'
    );
  }
  const interfaces = networkInterfaces();
  const host = listenAddress(interfaces, options.host || process.env.IPAROOM_LAN_HOST || undefined);
  const ponte = await detectPonte(options);
  const advertised = shareHostname(
    interfaces,
    host,
    options.hostname || process.env.IPAROOM_HOSTNAME || (!options.http && ponte.hostname)
  );
  const port = portNumber(options.port ?? 0);
  const tls = await tlsOptions(options, advertised, [lanAddress(interfaces), ponte.hostname]);
  const caPort = portNumber(options.caPort ?? process.env.IPAROOM_CA_PORT ?? 0, '--ca-port');
  const maxBytes = Number(configuredEnv.IPAROOM_MAX_UPLOAD_BYTES || 1073741824);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new Error('Invalid IPAROOM_MAX_UPLOAD_BYTES.');
  const dataDir = await mkdtemp(join(tmpdir(), 'iparoom-share-'));
  const token = randomBytes(32).toString('hex');
  Object.assign(process.env, {
    IPAROOM_ADMIN_TOKEN: token,
    IPAROOM_DATA_DIR: dataDir,
    IPAROOM_MAX_UPLOAD_BYTES: String(maxBytes),
    BODY_SIZE_LIMIT: String(maxBytes)
  });
  const abort = new AbortController(),
    pending = new Set();
  let handler,
    stopping = false,
    cleaning,
    startup,
    origin,
    certificateServer;
  const respond = (req, res) => {
    if (!handler || stopping) {
      res.statusCode = 503;
      res.end('IPA Room unavailable');
      return;
    }
    const task = Promise.resolve().then(() => handler(req, res));
    pending.add(task);
    task.catch((error) => res.destroy(error)).finally(() => pending.delete(task));
  };
  const server = tls ? createHttpsServer(tls, respond) : createHttpServer(respond);
  // Management bootstrap remains loopback-only even when the public share listens on all interfaces.
  const bootstrap = createHttpServer(respond);
  const close = async (listener) => {
    if (!listener.listening) return;
    await new Promise((resolveClose) => {
      listener.close(resolveClose);
      listener.closeAllConnections();
    });
  };
  const cleanup = () => {
    if (cleaning) return cleaning;
    stopping = true;
    abort.abort();
    cleaning = (async () => {
      await Promise.all([close(bootstrap), close(server), certificateServer?.close()]);
      await startup?.catch(() => {});
      await Promise.all([close(bootstrap), close(server), certificateServer?.close()]);
      await Promise.allSettled([...pending]);
      process.emit('iparoom:shutdown');
      await rm(dataDir, { recursive: true, force: true });
    })();
    return cleaning;
  };
  startup = (async () => {
    await new Promise((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolveListen);
    });
    origin = `${tls ? 'https' : 'http'}://${advertised}:${server.address().port}`;
    certificateServer = await startCertificateServer(tls, {
      host,
      hostname: advertised,
      port: caPort
    });
    Object.assign(process.env, {
      ORIGIN: origin,
      IPAROOM_BASE_URL: origin,
      IPAROOM_CA_CERT: tls?.rootPath || '',
      IPAROOM_CA_ROOT_URL: '',
      IPAROOM_CA_INSTALL_URL: certificateServer?.url || ''
    });
    handler = (await import(new URL('../runtime/web/handler.js', import.meta.url))).handler;
    await new Promise((resolveListen, reject) => {
      bootstrap.once('error', reject);
      bootstrap.listen(0, '127.0.0.1', resolveListen);
    });
  })();
  try {
    await startup;
  } catch (error) {
    await cleanup();
    throw error;
  }
  const request = async (path, init = {}) => {
    if (stopping) throw new Error('Share server has stopped.');
    const response = await fetch(`http://127.0.0.1:${bootstrap.address().port}${path}`, {
      ...init,
      redirect: 'error',
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
      signal: AbortSignal.any([
        abort.signal,
        AbortSignal.timeout(30 * 60 * 1000),
        ...(init.signal ? [init.signal] : [])
      ])
    });
    const result = response.status === 204 ? null : await response.json();
    if (!response.ok)
      throw new Error(result?.message || `IPA Room returned HTTP ${response.status}`);
    return result;
  };
  const buildPath = (id) => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid build ID.');
    return `/api/builds/${id}`;
  };
  return {
    origin,
    host,
    hostname: advertised,
    port: server.address().port,
    tls,
    close: cleanup,
    async upload(input, notes = '', signal) {
      if (notes.length > 2000) throw new Error('Release notes must be at most 2000 characters.');
      const file = typeof input === 'string' ? await ipaFile(input) : input;
      if (file.size > maxBytes) throw new Error('IPA exceeds IPAROOM_MAX_UPLOAD_BYTES.');
      const stream = createReadStream(file.path);
      try {
        return await request('/api/builds', {
          method: 'POST',
          signal,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(file.size),
            'X-IPAROOM-Notes': encodeURIComponent(notes)
          },
          body: stream,
          duplex: 'half'
        });
      } finally {
        stream.destroy();
      }
    },
    list: () => request('/api/builds'),
    info: (id) => request(buildPath(id)),
    revoke: (id) =>
      request(`${buildPath(id)}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false })
      }),
    status: () => ({
      serverUrl: origin,
      listenHost: host,
      hostname: advertised,
      port: server.address()?.port ?? null,
      temporary: true,
      https: Boolean(tls),
      configPath: options.configPaths.config,
      certificateInstallUrl: certificateServer?.url ?? null,
      caCertificatePath: tls?.rootPath ?? null,
      caFingerprint: certificateServer?.fingerprint ?? null,
      managedCertificates: tls?.managed ?? false,
      ponteHostname: ponte.hostname,
      ponteDetection: ponte.source,
      deviceInstallation: 'not-verified'
    })
  };
}
