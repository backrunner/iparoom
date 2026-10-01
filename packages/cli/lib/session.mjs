import { networkInterfaces, tmpdir } from 'node:os';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, X509Certificate, createPrivateKey } from 'node:crypto';
import { isIP } from 'node:net';
import { listenAddress, shareHostname } from './network.mjs';

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
export async function tlsOptions(options, advertised) {
  if (Boolean(options.cert) !== Boolean(options.key))
    throw new Error('HTTPS requires both --cert and --key.');
  if (!options.cert) return null;
  const cert = await readFile(resolve(options.cert)),
    key = await readFile(resolve(options.key));
  const leaf = new X509Certificate(cert);
  if (!leaf.checkPrivateKey(createPrivateKey(key)))
    throw new Error('HTTPS private key does not match the certificate.');
  const name = advertised.replace(/^\[|\]$/g, '');
  if (!(isIP(name) ? leaf.checkIP(name) : leaf.checkHost(name)))
    throw new Error(
      `HTTPS certificate does not match hostname ${advertised}. Set --hostname to a name in the certificate.`
    );
  return { cert, key };
}
export async function createShareSession(options = {}) {
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
  const advertised = shareHostname(
    interfaces,
    host,
    options.hostname || process.env.IPAROOM_HOSTNAME
  );
  const port = portNumber(options.port ?? 0);
  const tls = await tlsOptions(options, advertised);
  const maxBytes = Number(process.env.IPAROOM_MAX_UPLOAD_BYTES || 1073741824);
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
    origin;
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
      await Promise.all([close(bootstrap), close(server)]);
      await startup?.catch(() => {});
      await Promise.all([close(bootstrap), close(server)]);
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
    Object.assign(process.env, { ORIGIN: origin, IPAROOM_BASE_URL: origin });
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
      deviceInstallation: 'not-verified'
    })
  };
}
