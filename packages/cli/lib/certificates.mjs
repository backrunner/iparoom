import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile, chmod, rename, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes, X509Certificate, createPrivateKey, createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { createServer } from 'node:http';
import QRCode from 'qrcode';
import { hostname } from './network.mjs';
import { userDataPaths } from './config.mjs';
import {
  rootCertificate,
  certificateInfo,
  certificateAsset,
  certificatePage
} from './ca-public.mjs';
const exec = promisify(execFile);
const openssl = async (args) => {
  try {
    return await exec('openssl', args, { timeout: 30000, maxBuffer: 1024 * 1024 });
  } catch (error) {
    throw new Error(
      error.code === 'ENOENT'
        ? 'OpenSSL is required for managed HTTPS. Install OpenSSL or supply --cert/--key.'
        : `Certificate operation failed: ${error.stderr || error.message}`
    );
  }
};
export function certificateDirectory(options = {}) {
  return userDataPaths(
    options.userDataDir ? { env: { IPAROOM_USER_DATA_DIR: options.userDataDir } } : {}
  ).certificates;
}
export function validateLeaf(cert, key, advertised, checkDates = true) {
  const leaf = new X509Certificate(cert);
  if (!leaf.checkPrivateKey(createPrivateKey(key)))
    throw new Error('HTTPS private key does not match the certificate.');
  const name = advertised.replace(/^\[|\]$/g, '');
  if (!(isIP(name) ? leaf.checkIP(name) : leaf.checkHost(name, { subject: 'never' })))
    throw new Error(
      `HTTPS certificate does not match hostname ${advertised}. Set --hostname to a name in the certificate.`
    );
  if (
    checkDates &&
    (Date.parse(leaf.validFrom) > Date.now() || Date.parse(leaf.validTo) <= Date.now())
  )
    throw new Error('HTTPS certificate is not currently valid.');
  return leaf;
}
async function exists(path) {
  return stat(path)
    .then(() => true)
    .catch((e) => {
      if (e.code === 'ENOENT') return false;
      throw e;
    });
}
export async function managedCertificate(names, options = {}) {
  const dir = certificateDirectory(options);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const lock = join(dir, '.issuance-lock');
  let held = false;
  const deadline = Date.now() + 35000;
  while (!held) {
    try {
      await mkdir(lock, { mode: 0o700 });
      held = true;
      await writeFile(join(lock, 'owner'), String(process.pid), { mode: 0o600 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() > deadline)
        throw new Error(
          `Certificate issuance is locked. If no IPA Room process is issuing certificates, remove ${lock}.`
        );
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  let work;
  try {
    work = await mkdtemp(join(dir, '.issuance-'));
    const rootPath = join(dir, 'root.crt'),
      rootKeyPath = join(dir, 'root.key');
    if (!(await exists(rootPath)) && !(await exists(rootKeyPath))) {
      await openssl([
        'req',
        '-x509',
        '-newkey',
        'rsa:3072',
        '-nodes',
        '-sha256',
        '-days',
        '3650',
        '-subj',
        `/CN=IPA Room CA ${randomBytes(4).toString('hex')}`,
        '-addext',
        'basicConstraints=critical,CA:TRUE,pathlen:0',
        '-addext',
        'keyUsage=critical,keyCertSign,cRLSign',
        '-keyout',
        join(work, 'root.key'),
        '-out',
        join(work, 'root.crt')
      ]);
      await chmod(join(work, 'root.key'), 0o600);
      await rename(join(work, 'root.key'), rootKeyPath);
      await rename(join(work, 'root.crt'), rootPath);
    }
    if (!(await exists(rootPath)) || !(await exists(rootKeyPath)))
      throw new Error(
        'CA is incomplete; restore its certificate and matching key. IPA Room will not silently replace an existing CA.'
      );
    const rootPem = await readFile(rootPath);
    const root = rootCertificate(rootPem);
    if (!root.checkPrivateKey(createPrivateKey(await readFile(rootKeyPath))))
      throw new Error('CA private key does not match its certificate.');
    await chmod(rootKeyPath, 0o600);
    if (Date.parse(root.validTo) - Date.now() < 91 * 86400000)
      throw new Error(
        'CA expires within 91 days. Create and explicitly trust a new CA before issuing more certificates.'
      );
    const hosts = [...new Set(names.filter(Boolean).map(hostname))].sort();
    const id = createHash('sha256')
      .update(root.raw)
      .update(hosts.join(','))
      .digest('hex')
      .slice(0, 24);
    const certPath = join(dir, `server-${id}.crt`),
      keyPath = join(dir, `server-${id}.key`);
    let renew = true;
    if ((await exists(certPath)) && (await exists(keyPath))) {
      await chmod(keyPath, 0o600);
      const cert = await readFile(certPath),
        key = await readFile(keyPath);
      try {
        const leaf = validateLeaf(cert, key, hosts[0], false);
        for (const name of hosts.slice(1)) validateLeaf(cert, key, name, false);
        renew =
          leaf.ca ||
          !leaf.keyUsage?.includes('1.3.6.1.5.5.7.3.1') ||
          Date.parse(leaf.validFrom) > Date.now() ||
          Date.parse(leaf.validTo) - Date.now() < 7 * 86400000 ||
          !leaf.verify(root.publicKey);
      } catch {
        // Only cached leaves are disposable. Never replace an invalid existing root.
        renew = true;
      }
    }
    if (renew) {
      const leafKey = join(work, 'server.key'),
        csr = join(work, 'server.csr'),
        cert = join(work, 'server.crt'),
        ext = join(work, 'extensions.cnf');
      await openssl([
        'req',
        '-new',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-sha256',
        '-subj',
        '/CN=IPA Room HTTPS',
        '-keyout',
        leafKey,
        '-out',
        csr
      ]);
      await writeFile(
        ext,
        `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\nsubjectAltName=${hosts.map((h) => `${isIP(h.replace(/^\[|\]$/g, '')) ? 'IP' : 'DNS'}:${h.replace(/^\[|\]$/g, '')}`).join(',')}\n`,
        { mode: 0o600 }
      );
      await openssl([
        'x509',
        '-req',
        '-in',
        csr,
        '-CA',
        rootPath,
        '-CAkey',
        rootKeyPath,
        '-set_serial',
        `0x${randomBytes(16).toString('hex')}`,
        '-days',
        '90',
        '-sha256',
        '-extfile',
        ext,
        '-out',
        cert
      ]);
      await chmod(leafKey, 0o600);
      await rename(leafKey, keyPath);
      await rename(cert, certPath);
    }
    await openssl(['verify', '-CAfile', rootPath, '-purpose', 'sslserver', certPath]);
    return {
      cert: await readFile(certPath),
      key: await readFile(keyPath),
      rootPem,
      rootPath,
      certPath,
      keyPath,
      managed: true
    };
  } finally {
    if (work) await rm(work, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}
export async function tlsOptions(options, advertised, names = []) {
  if (Boolean(options.cert) !== Boolean(options.key))
    throw new Error('HTTPS requires both --cert and --key.');
  if (options.http) {
    if (options.cert || options.ca)
      throw new Error('--http cannot be combined with certificate options.');
    return null;
  }
  if (options.ca && !options.cert) throw new Error('--ca requires a supplied --cert/--key pair.');
  if (!options.cert)
    return managedCertificate([advertised, ...names, 'localhost', '127.0.0.1'], options);
  const cert = await readFile(resolve(options.cert)),
    key = await readFile(resolve(options.key));
  validateLeaf(cert, key, advertised);
  let rootPem, rootPath;
  if (options.ca) {
    rootPath = resolve(options.ca);
    rootPem = await readFile(rootPath);
    rootCertificate(rootPem);
    // OpenSSL checks the complete supplied chain, hostname has already been checked above.
    await openssl([
      'verify',
      '-CAfile',
      rootPath,
      '-untrusted',
      resolve(options.cert),
      '-purpose',
      'sslserver',
      resolve(options.cert)
    ]);
  }
  return {
    cert,
    key,
    rootPem,
    rootPath,
    certPath: resolve(options.cert),
    keyPath: resolve(options.key),
    managed: false
  };
}
export async function startCertificateServer(tls, { host, hostname: advertised, port = 0 }) {
  if (!tls?.rootPem) return null;
  const pem = tls.rootPem;
  const info = certificateInfo(pem);
  let page;
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'"
    );
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }
    const path = req.url?.split('?')[0];
    const asset =
      path === '/ca' || path === '/ca/'
        ? { body: page, type: 'text/html; charset=utf-8' }
        : path?.startsWith('/ca/')
          ? certificateAsset(pem, path.slice(4))
          : null;
    if (!asset || !asset.body) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.setHeader('Content-Type', asset.type);
    if (asset.filename)
      res.setHeader('Content-Disposition', `attachment; filename="${asset.filename}"`);
    res.end(req.method === 'HEAD' ? undefined : asset.body);
  });
  try {
    await new Promise((done, reject) => {
      server.once('error', reject);
      server.listen(port, host, done);
    });
    const origin = `http://${advertised}:${server.address().port}`;
    page = certificatePage(pem, {
      origin,
      qr: await QRCode.toDataURL(`${origin}/ca`, { width: 160, margin: 1 })
    });
    return {
      server,
      url: `${origin}/ca`,
      ...info,
      async close() {
        if (!server.listening) return;
        await new Promise((done) => {
          server.close(done);
          server.closeAllConnections();
        });
      }
    };
  } catch (error) {
    if (server.listening) server.close();
    throw error;
  }
}
