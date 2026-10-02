#!/usr/bin/env node
import { Command } from 'commander';
import { launch } from '../lib/launch.mjs';
import { ipaFile } from '../lib/session.mjs';
import { configureMcpCommand } from '../lib/mcp.mjs';
import { installSkill } from '../lib/skill.mjs';
import { fileURLToPath } from 'node:url';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import {
  userConfig,
  loadUserConfig,
  updateClientCredentials,
  explicitOptions
} from '../lib/config.mjs';
import { basename, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline/promises';
function serverUrl(value) {
  if (!value)
    throw new Error('Set IPAROOM_SERVER or run iparoom login --server https://192.168.1.10:8443');
  const url = new URL(value);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Server must be an HTTP(S) origin without a path, credentials or query.');
  return url.origin;
}
async function credentials(options) {
  const saved = userConfig().config.client;
  const server = serverUrl(options.server || process.env.IPAROOM_SERVER || saved.server);
  const token =
    process.env.IPAROOM_TOKEN ||
    (saved.server && serverUrl(saved.server) === server ? saved.token : undefined);
  if (!token) throw new Error('Set IPAROOM_TOKEN or run iparoom login.');
  return { server, token };
}
async function request(path, options, init = {}) {
  const { server, token } = await credentials(options);
  const response = await fetch(`${server}${path}`, {
    ...init,
    redirect: 'error',
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30 * 60 * 1000)
  });
  if (!response.ok) {
    let message = `Server returned HTTP ${response.status}`;
    try {
      message = (await response.json()).message || message;
    } catch {}
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}
function output(value, options) {
  if (options.json) console.log(JSON.stringify(value, null, 2));
  else if (value.build) {
    const b = value.build;
    console.log(
      `${b.name} ${b.version} (${b.buildNumber})\nID: ${b.id}\nInstall page: ${b.installUrl || 'revoked'}\nDownload: ${b.downloadUrl || 'revoked'}${b.otaUrl ? `\nOTA: ${b.otaUrl}` : '\nOTA requires a device-reachable LAN HTTPS server with a trusted certificate.'}`
    );
  } else console.log(JSON.stringify(value, null, 2));
}
async function upload(input, options) {
  if ((options.notes || '').length > 2000)
    throw new Error('Release notes must be at most 2000 characters.');
  const file = await ipaFile(input);
  if (!options.json)
    console.error(`Uploading ${basename(file.path)} (${(file.size / 1024 ** 2).toFixed(1)} MB)…`);
  const stream = createReadStream(file.path);
  try {
    output(
      await request('/api/builds', options, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(file.size),
          'X-IPAROOM-Notes': encodeURIComponent(options.notes || '')
        },
        body: stream,
        duplex: 'half'
      }),
      options
    );
  } finally {
    stream.destroy();
  }
}
function buildId(value) {
  if (!/^[a-f0-9-]{36}$/.test(value)) throw new Error('Invalid build ID.');
  return value;
}
async function promptToken() {
  if (!process.stdin.isTTY) throw new Error('Non-interactive login requires IPAROOM_TOKEN.');
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stderr.write(chunk);
      callback();
    }
  });
  const readline = createInterface({ input: process.stdin, output, terminal: true });
  process.stderr.write('Admin token (hidden): ');
  muted = true;
  try {
    return (await readline.question('')).trim();
  } finally {
    muted = false;
    readline.close();
    process.stderr.write('\n');
  }
}
const program = new Command()
  .name('iparoom')
  .enablePositionalOptions()
  .description('Share Xcode IPA builds with your test devices')
  .version('0.1.0')
  .argument('[ipa-or-directory]', 'Start a temporary LAN share for an IPA')
  .option('--host <ipv4>', 'Listening IPv4 address (default: 0.0.0.0)')
  .option('--hostname <name>', 'Hostname or IP used in share links and HTTPS certificates')
  .option('--port <number>', 'Listening port (default: an available port)', '0')
  .option('--no-open', 'Do not open a browser automatically')
  .option('--cert <pem>', 'HTTPS certificate chain PEM')
  .option('--key <pem>', 'HTTPS private key PEM')
  .option('--ca <pem>', 'Public root CA for a supplied certificate chain')
  .option('--ca-port <number>', 'Certificate-only HTTP bootstrap port (default: available port)')
  .option('--http', 'Use HTTP instead of managed HTTPS')
  .option('--ponte-hostname <name>', 'Surge Ponte domain, e.g. mymac.sgponte')
  .option('--no-ponte', 'Disable automatic Ponte hostname selection')
  .option('--notes <text>', 'Release notes', '')
  .option('--json', 'Print machine-readable startup result')
  .action(async (input, _options, command) => {
    const options = explicitOptions(command);
    if (!input) program.help();
    await launch(await ipaFile(input), options);
  });
configureMcpCommand(program.command('mcp')).action(async (_options, command) => {
  const { runMcp } = await import('../lib/mcp.mjs');
  const options = explicitOptions(command);
  for (const [key, value] of Object.entries(program.opts())) {
    if (
      program.getOptionValueSource(key) !== 'default' &&
      command.getOptionValueSource(key) !== 'cli'
    )
      options[key] = value;
  }
  await runMcp(options);
});
function common(command) {
  return command
    .hook('preAction', (_command, actionCommand) => {
      if (program.opts().json) actionCommand.setOptionValue('json', true);
    })
    .option('--server <url>', 'Override server origin')
    .option('--json', 'Print machine-readable JSON');
}
program
  .command('skill')
  .description('Manage the companion agent skill')
  .command('install')
  .description('Install iparoom-install in your Codex skills directory')
  .option(
    '--path <directory>',
    'Parent skills directory (default: CODEX_HOME/skills or ~/.codex/skills)'
  )
  .option('--json', 'Print machine-readable result')
  .action(async (options) => {
    const source = fileURLToPath(new URL('../skills/iparoom-install', import.meta.url));
    const result = await installSkill(source, options.path);
    if (options.json || program.opts().json) console.log(JSON.stringify(result, null, 2));
    else
      console.log(
        `${result.status}: ${result.path}\nUse $iparoom-install in your agent. Start a new task if it is not yet discoverable.`
      );
  });
program
  .command('config')
  .description('Create or locate ~/.iparoom/config.yaml for manual editing')
  .action(() => console.log(loadUserConfig({ legacyEnvFile: resolve('.env') }).paths.config));
program
  .command('login')
  .option('--server <url>', 'IPA Room server origin (default: config.yaml client.server)')
  .description('Validate and store credentials with file mode 0600')
  .action(async (options) => {
    const saved = userConfig().config.client;
    const server = serverUrl(options.server || process.env.IPAROOM_SERVER || saved.server),
      token =
        process.env.IPAROOM_TOKEN ||
        (saved.server && serverUrl(saved.server) === server ? saved.token : '') ||
        (await promptToken());
    const response = await fetch(`${server}/api/builds`, {
      redirect: 'error',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok)
      throw new Error(`Login failed (HTTP ${response.status}). Check the server and token.`);
    await updateClientCredentials(server, token);
    console.log(`Logged in to ${server}`);
  });
program
  .command('logout')
  .description('Clear client credentials while preserving config.yaml')
  .action(async () => {
    await updateClientCredentials();
    console.log('Stored credentials removed.');
  });
common(
  program
    .command('upload <ipa-or-directory>')
    .description('Upload an IPA and generate installation links')
    .option('--notes <text>', 'Release notes', '')
).action(upload);
common(program.command('list').description('List uploaded builds')).action(async (options) => {
  const result = await request('/api/builds', options);
  if (options.json) output(result, options);
  else {
    if (!result.builds.length) console.log('No builds yet.');
    for (const b of result.builds)
      console.log(
        `${b.id}  ${b.name}  ${b.version} (${b.buildNumber})  ${b.shareToken ? 'shared' : 'revoked'}`
      );
  }
});
common(program.command('info <id>').description('Get build metadata and links')).action(
  async (id, options) => output(await request(`/api/builds/${buildId(id)}`, options), options)
);
common(
  program
    .command('share <id>')
    .description('Rotate the share link, or revoke it')
    .option('--revoke', 'Revoke all current share URLs')
).action(async (id, options) =>
  output(
    await request(`/api/builds/${buildId(id)}/share`, options, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !options.revoke })
    }),
    options
  )
);
common(
  program
    .command('delete <id>')
    .description('Delete a build and its IPA')
    .option('--yes', 'Confirm permanent deletion')
).action(async (id, options) => {
  if (!options.yes) throw new Error('Deletion requires --yes.');
  await request(`/api/builds/${buildId(id)}`, options, { method: 'DELETE' });
  if (options.json) console.log(JSON.stringify({ deleted: id }));
  else console.log(`Deleted ${id}`);
});
common(
  program
    .command('export <archive>')
    .description('Run xcodebuild -exportArchive, then upload')
    .requiredOption('--options <plist>', 'ExportOptions.plist path')
    .requiredOption('--output <directory>', 'Export directory')
    .option('--notes <text>', 'Release notes', '')
).action(async (archive, options) => {
  await credentials(options);
  const archivePath = resolve(archive),
    exportOptions = resolve(options.options),
    outputPath = resolve(options.output);
  await stat(archivePath);
  await stat(exportOptions);
  try {
    const existing = await readdir(outputPath);
    if (existing.some((name) => name.toLowerCase().endsWith('.ipa')))
      throw new Error(
        'Export output already contains an IPA. Choose a fresh output directory to avoid uploading a stale build.'
      );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await new Promise((resolvePromise, reject) => {
    const child = spawn(
      'xcodebuild',
      [
        '-exportArchive',
        '-archivePath',
        archivePath,
        '-exportOptionsPlist',
        exportOptions,
        '-exportPath',
        outputPath
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    child.stdout.pipe(process.stderr);
    child.stderr.pipe(process.stderr);
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`xcodebuild export failed (${code}).`))
    );
  });
  await upload(outputPath, options);
});
try {
  await program.parseAsync(process.argv);
} catch (error) {
  console.error(`iparoom: ${error.message || 'Operation failed'}`);
  process.exitCode = 1;
}
