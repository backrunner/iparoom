import { homedir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  existsSync,
  cpSync,
  readdirSync,
  renameSync,
  unlinkSync,
  linkSync,
  statSync,
  rmSync
} from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import { parseDocument, stringify } from 'yaml';

export function userDataPaths({ env = process.env, home = homedir() } = {}) {
  const root = resolve(env.IPAROOM_USER_DATA_DIR || home, '.iparoom');
  return {
    root,
    config: join(root, 'config.yaml'),
    certificates: join(root, 'certificates'),
    data: join(root, 'data')
  };
}
export const defaults = {
  version: 1,
  server: {
    host: '0.0.0.0',
    hostname: '',
    port: 3000,
    devPort: 5173,
    baseUrl: '',
    adminToken: '',
    maxUploadBytes: 1073741824,
    bodySizeLimit: ''
  },
  https: { enabled: true, certificate: '', privateKey: '', caCertificate: '', caPort: 0 },
  ponte: { enabled: true, hostname: '' },
  share: { port: 0, openBrowser: true },
  mcp: { transport: 'stdio', port: 3001, token: '' },
  client: { server: '', token: '' },
  storage: { dataDir: 'data' }
};
const fields = {
  server: {
    host: 'IPAROOM_LAN_HOST',
    hostname: 'IPAROOM_HOSTNAME',
    baseUrl: 'IPAROOM_BASE_URL',
    adminToken: 'IPAROOM_ADMIN_TOKEN',
    maxUploadBytes: 'IPAROOM_MAX_UPLOAD_BYTES',
    bodySizeLimit: 'BODY_SIZE_LIMIT'
  },
  https: {
    enabled: 'IPAROOM_HTTPS',
    certificate: 'IPAROOM_TLS_CERT',
    privateKey: 'IPAROOM_TLS_KEY',
    caCertificate: 'IPAROOM_CA_CERT',
    caPort: 'IPAROOM_CA_PORT'
  },
  ponte: { enabled: 'IPAROOM_PONTE', hostname: 'IPAROOM_PONTE_HOSTNAME' },
  mcp: { token: 'IPAROOM_MCP_TOKEN' },
  client: { server: 'IPAROOM_SERVER', token: 'IPAROOM_TOKEN' },
  storage: { dataDir: 'IPAROOM_DATA_DIR' }
};
function invalid(path, field) {
  throw new Error(`Invalid ${path}: ${field}. Configuration values are not logged.`);
}
export function validateConfig(input, path = 'config.yaml') {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    invalid(path, 'expected a YAML mapping');
  const config = structuredClone(defaults);
  for (const [section, value] of Object.entries(input)) {
    if (!Object.hasOwn(defaults, section)) invalid(path, `unknown field ${section}`);
    if (section === 'version') {
      if (value !== 1) invalid(path, 'version must be 1');
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
      invalid(path, `${section} must be a mapping`);
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(defaults[section], key)) invalid(path, `unknown field ${section}.${key}`);
      if (typeof item !== typeof defaults[section][key])
        invalid(path, `${section}.${key} has the wrong type`);
      if (typeof item === 'number' && (!Number.isSafeInteger(item) || item < 0))
        invalid(path, `${section}.${key} must be a nonnegative integer`);
      config[section][key] = item;
    }
  }
  for (const [section, key] of [
    ['server', 'port'],
    ['server', 'devPort'],
    ['https', 'caPort'],
    ['share', 'port'],
    ['mcp', 'port']
  ]) {
    if (config[section][key] > 65535 || (section === 'server' && config[section][key] === 0))
      invalid(path, `${section}.${key} is outside the port range`);
  }
  if (!config.server.maxUploadBytes) invalid(path, 'server.maxUploadBytes must be positive');
  if (!config.storage.dataDir.trim()) invalid(path, 'storage.dataDir must not be empty');
  if (!['stdio', 'http'].includes(config.mcp.transport))
    invalid(path, 'mcp.transport must be stdio or http');
  if (config.server.adminToken && config.server.adminToken.length < 24)
    invalid(path, 'server.adminToken must contain at least 24 characters');
  if (config.mcp.token && config.mcp.token.length < 24)
    invalid(path, 'mcp.token must contain at least 24 characters');
  if (Boolean(config.https.certificate) !== Boolean(config.https.privateKey))
    invalid(path, 'https.certificate and https.privateKey must be configured together');
  for (const [section, key] of [
    ['server', 'baseUrl'],
    ['client', 'server']
  ]) {
    if (!config[section][key]) continue;
    try {
      const u = new URL(config[section][key]);
      if (
        !['http:', 'https:'].includes(u.protocol) ||
        u.username ||
        u.password ||
        u.pathname !== '/' ||
        u.search ||
        u.hash
      )
        throw new Error();
    } catch {
      invalid(path, `${section}.${key} must be an HTTP(S) origin`);
    }
  }
  return config;
}
function parseConfig(text, path) {
  if (Buffer.byteLength(text) > 65536) invalid(path, 'file exceeds 64 KiB');
  const doc = parseDocument(text, { prettyErrors: false, uniqueKeys: true, logLevel: 'silent' });
  if (doc.errors.length || doc.warnings.length)
    invalid(path, `YAML ${doc.errors[0]?.code || doc.warnings[0]?.code}`);
  let value;
  try {
    value = doc.toJS({ maxAliasCount: 0 });
  } catch {
    invalid(path, 'YAML aliases are unsupported');
  }
  return { doc, config: validateConfig(value, path) };
}
function temporaryPath(path) {
  return `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
}
function createFile(path, text) {
  const temp = temporaryPath(path);
  try {
    writeFileSync(temp, text, { mode: 0o600, flag: 'wx' });
    try {
      linkSync(temp, path);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}
export function configurationPath(value, root = userDataPaths().root) {
  if (!value) return '';
  const expanded =
    value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : value;
  return isAbsolute(expanded) ? expanded : resolve(root, expanded);
}
function migrate(paths, { env = process.env, home = homedir(), legacyEnvFile } = {}) {
  const config = structuredClone(defaults);
  let legacyValues = {};
  if (legacyEnvFile && existsSync(legacyEnvFile)) {
    try {
      legacyValues = parseEnv(readFileSync(legacyEnvFile, 'utf8'));
    } catch {
      invalid(legacyEnvFile, 'invalid legacy environment file');
    }
  }
  const legacy = resolve(
    env.IPAROOM_CONFIG_DIR ||
      legacyValues.IPAROOM_CONFIG_DIR ||
      join(env.IPAROOM_USER_DATA_DIR || home, '.config', 'iparoom')
  );
  const json = join(legacy, 'config.json');
  if (existsSync(json)) {
    let saved;
    try {
      saved = JSON.parse(readFileSync(json, 'utf8'));
    } catch {
      invalid(json, 'invalid legacy JSON');
    }
    if (!saved || typeof saved !== 'object' || Array.isArray(saved))
      invalid(json, 'legacy JSON must be an object');
    if (typeof saved.server === 'string') config.client.server = saved.server;
    if (typeof saved.token === 'string') config.client.token = saved.token;
  }
  if (Object.keys(legacyValues).some((key) => key.startsWith('IPAROOM_'))) {
    const values = legacyValues;
    for (const [section, mapping] of Object.entries(fields))
      for (const [key, variable] of Object.entries(mapping)) {
        if (!values[variable]) continue;
        const type = typeof config[section][key];
        config[section][key] =
          type === 'boolean'
            ? values[variable] !== '0'
            : type === 'number'
              ? Number(values[variable])
              : values[variable];
        if ((section === 'https' && key !== 'enabled' && key !== 'caPort') || section === 'storage')
          config[section][key] = resolve(values[variable]);
      }
    if (values.PORT) config.server.port = config.server.devPort = Number(values.PORT);
    if (!values.IPAROOM_BASE_URL && values.IPAROOM_PUBLIC_URL)
      config.server.baseUrl = values.IPAROOM_PUBLIC_URL;
  }
  validateConfig(config, paths.config);
  const oldCertificates = resolve(
    env.IPAROOM_CERT_DIR || legacyValues.IPAROOM_CERT_DIR || join(legacy, 'certificates')
  );
  if (
    resolve(oldCertificates) !== paths.certificates &&
    existsSync(oldCertificates) &&
    !existsSync(paths.certificates)
  ) {
    // Publish the entire CA atomically so concurrent launches never see a partial key pair.
    const temp = temporaryPath(paths.certificates);
    try {
      cpSync(oldCertificates, temp, {
        recursive: true,
        force: false,
        filter: (source) =>
          source === oldCertificates ||
          /^(root\.(crt|key)|server-[a-f0-9]+\.(crt|key))$/.test(source.split(/[\\/]/).at(-1))
      });
      chmodSync(temp, 0o700);
      for (const name of readdirSync(temp))
        if (name.endsWith('.key')) chmodSync(join(temp, name), 0o600);
      try {
        renameSync(temp, paths.certificates);
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
      }
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
  return config;
}
export function loadUserConfig(options = {}) {
  const paths = userDataPaths(options);
  mkdirSync(paths.root, { recursive: true, mode: 0o700 });
  chmodSync(paths.root, 0o700);
  if (!existsSync(paths.config)) {
    const config = migrate(paths, options);
    createFile(
      paths.config,
      '# IPA Room configuration. Edit this file and restart the service.\n# Relative file paths resolve inside this .iparoom directory.\n' +
        stringify(config)
    );
  }
  if ((statSync(paths.config).mode & 0o777) !== 0o600) chmodSync(paths.config, 0o600);
  const text = readFileSync(paths.config, 'utf8');
  return { ...parseConfig(text, paths.config), paths, text };
}
let cached;
export function userConfig() {
  const path = userDataPaths().config;
  if (!cached || cached.paths.config !== path) cached = loadUserConfig();
  return cached;
}
export function configurationEnvironment(config, paths = userDataPaths()) {
  /** @type {Record<string, string>} */
  const result = {};
  for (const [section, mapping] of Object.entries(fields))
    for (const [key, variable] of Object.entries(mapping)) {
      let value = config[section][key];
      if ((section === 'https' && !['enabled', 'caPort'].includes(key)) || section === 'storage')
        value = configurationPath(value, paths.root);
      result[variable] = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
    }
  return result;
}
export function effectiveEnvironment(env = process.env) {
  const { config, paths } = userConfig();
  return { ...configurationEnvironment(config, paths), ...env };
}
export function shareOptions(options = {}) {
  const { config, paths } = userConfig();
  const env = effectiveEnvironment();
  const http = options.http ?? env.IPAROOM_HTTPS === '0';
  return {
    host: env.IPAROOM_LAN_HOST || undefined,
    hostname: env.IPAROOM_HOSTNAME || undefined,
    port: config.share.port,
    open: config.share.openBrowser,
    http,
    ponte: env.IPAROOM_PONTE !== '0',
    ponteHostname: env.IPAROOM_PONTE_HOSTNAME || undefined,
    cert: !http ? env.IPAROOM_TLS_CERT || undefined : undefined,
    key: !http ? env.IPAROOM_TLS_KEY || undefined : undefined,
    ca: !http ? env.IPAROOM_CA_CERT || undefined : undefined,
    caPort: env.IPAROOM_CA_PORT || '0',
    transport: config.mcp.transport,
    mcpPort: config.mcp.port,
    ...options,
    configPaths: paths
  };
}
export function explicitOptions(command) {
  return Object.fromEntries(
    Object.entries(command.opts()).filter(
      ([key]) => command.getOptionValueSource(key) !== 'default'
    )
  );
}
export async function updateClientCredentials(server = '', token = '') {
  const { paths } = loadUserConfig();
  const lock = join(paths.root, '.config-lock');
  const deadline = Date.now() + 5000;
  while (true) {
    try {
      await mkdir(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() > deadline)
        throw new Error('config.yaml is locked by another writer. Retry after it finishes.');
      await new Promise((done) => setTimeout(done, 50));
    }
  }
  try {
    const { doc, text } = loadUserConfig();
    doc.setIn(['client', 'server'], server);
    doc.setIn(['client', 'token'], token);
    const next = doc.toString();
    parseConfig(next, paths.config);
    const temp = temporaryPath(paths.config);
    try {
      writeFileSync(temp, next, { mode: 0o600, flag: 'wx' });
      if (readFileSync(paths.config, 'utf8') !== text)
        throw new Error(
          'config.yaml changed while saving credentials. Retry to preserve your edit.'
        );
      renameSync(temp, paths.config);
    } finally {
      if (existsSync(temp)) unlinkSync(temp);
    }
    cached = undefined;
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
