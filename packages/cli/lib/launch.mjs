import { networkInterfaces, tmpdir } from 'node:os';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import QRCode from 'qrcode';
import { lanAddress } from './network.mjs';
function openBrowser(url) {
  const command =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'rundll32.exe'
        : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { stdio: 'ignore' });
  child.on('error', () => console.error(`Could not open browser automatically. Open ${url}`));
  child.on('exit', (code) => {
    if (code) console.error(`Could not open browser automatically. Open ${url}`);
  });
}
export async function launch(file, options) {
  const runtime = fileURLToPath(new URL('../runtime/web/handler.js', import.meta.url));
  try {
    await stat(runtime);
  } catch {
    throw new Error(
      'Bundled web server is missing. From source run pnpm build:cli, or install the packaged iparoom-cli tarball.'
    );
  }
  if (Boolean(options.cert) !== Boolean(options.key))
    throw new Error('HTTPS requires both --cert and --key.');
  const tls = options.cert
    ? { cert: await readFile(resolve(options.cert)), key: await readFile(resolve(options.key)) }
    : null;
  const host = lanAddress(networkInterfaces(), options.host || process.env.IPAROOM_LAN_HOST);
  const port = Number(options.port ?? 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('--port must be an integer between 0 and 65535.');
  if ((options.notes || '').length > 2000)
    throw new Error('Release notes must be at most 2000 characters.');
  const maxBytes = Number(process.env.IPAROOM_MAX_UPLOAD_BYTES || 1073741824);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new Error('Invalid IPAROOM_MAX_UPLOAD_BYTES.');
  if (file.size > maxBytes) throw new Error('IPA exceeds IPAROOM_MAX_UPLOAD_BYTES.');
  let handler;
  const pending = new Set();
  const abort = new AbortController();
  let bootstrap, stream, startup, cleaning;
  const respond = (req, res) => {
    if (!handler) {
      res.statusCode = 503;
      res.end('Starting IPA Room');
    } else {
      const task = Promise.resolve().then(() => handler(req, res));
      pending.add(task);
      task.catch((error) => res.destroy(error)).finally(() => pending.delete(task));
    }
  };
  const server = tls ? createHttpsServer(tls, respond) : createHttpServer(respond);
  const dataDir = await mkdtemp(join(tmpdir(), 'iparoom-share-'));
  const token = randomBytes(32).toString('hex');
  // A direct file launch is an isolated session, independent of remote CLI login and project .env files.
  Object.assign(process.env, {
    IPAROOM_ADMIN_TOKEN: token,
    IPAROOM_DATA_DIR: dataDir,
    IPAROOM_MAX_UPLOAD_BYTES: String(maxBytes),
    BODY_SIZE_LIMIT: String(maxBytes)
  });
  let stopped = false;
  const close = async (listener) => {
    if (!listener?.listening) return;
    await new Promise((resolve) => {
      listener.close(resolve);
      listener.closeAllConnections();
    });
  };
  const cleanup = () => {
    if (cleaning) return cleaning;
    stopped = true;
    abort.abort();
    stream?.destroy();
    cleaning = (async () => {
      // Startup and request handlers must settle before closing SQLite and deleting its directory.
      await close(bootstrap);
      await startup?.catch(() => {});
      await close(server);
      await Promise.allSettled([...pending]);
      process.emit('iparoom:shutdown');
      await rm(dataDir, { recursive: true, force: true });
    })();
    return cleaning;
  };
  const stop = () => {
    cleanup()
      .then(() => {
        process.exitCode = 0;
      })
      .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const initialize = async () => {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
    if (stopped) return;
    const address = server.address();
    const origin = `${tls ? 'https' : 'http'}://${host}:${address.port}`;
    Object.assign(process.env, { ORIGIN: origin, IPAROOM_BASE_URL: origin });
    // adapter-node reads its environment at import time, so import only after the actual port is known.
    handler = (await import(new URL('../runtime/web/handler.js', import.meta.url))).handler;
    if (stopped) return;
    // Import through a temporary loopback-only listener; external clients still use the configured TLS server.
    bootstrap = createHttpServer(respond);
    stream = createReadStream(file.path);
    let result;
    try {
      await new Promise((resolve, reject) => {
        bootstrap.once('error', reject);
        bootstrap.listen(0, '127.0.0.1', resolve);
      });
      const response = await fetch(`http://127.0.0.1:${bootstrap.address().port}/api/builds`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(file.size),
          'X-IPAROOM-Notes': encodeURIComponent(options.notes || '')
        },
        body: stream,
        duplex: 'half',
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30 * 60 * 1000)])
      });
      result = await response.json();
      if (!response.ok) throw new Error(result.message || `Import failed (${response.status})`);
    } finally {
      stream.destroy();
      await close(bootstrap);
    }
    if (stopped) return;
    if (options.json)
      console.log(JSON.stringify({ ...result, serverUrl: origin, temporary: true }, null, 2));
    else {
      console.log(
        `${result.build.name} ${result.build.version} (${result.build.buildNumber})\nInstall page: ${result.build.installUrl}\nDownload: ${result.build.downloadUrl}`
      );
      console.log(
        await QRCode.toString(result.build.installUrl, { type: 'terminal', small: true })
      );
    }
    console.error(
      `Sharing on ${origin}. Press Ctrl+C to stop; temporary IPA data will be removed.`
    );
    if (!tls)
      console.error(
        'HTTP provides the page and download. iOS OTA needs --cert/--key with a certificate trusted by the device.'
      );
    if (options.open !== false) openBrowser(result.build.installUrl);
  };
  startup = initialize();
  try {
    await startup;
  } catch (error) {
    const interrupted = stopped;
    await cleanup();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    if (!interrupted) throw error;
  }
}
